// it is very important that the way we declare our buffers here
// matches how we declare them in the javascript code
@group(0) @binding(0)
var<storage, read_write> positions: array<vec2<f32>>;
@group(0) @binding(1)
var<storage, read_write> velocities: array<vec2<f32>>;
@group(0) @binding(2)
var<storage, read_write> pressure_accelerations: array<vec2<f32>>;
@group(0) @binding(3)
var<storage, read_write> viscosity_accelerations: array<vec2<f32>>;

@group(0) @binding(4)
var<storage, read_write> densities: array<f32>;
@group(0) @binding(5)
var<storage, read_write> pressures: array<f32>;

// variables for the grid!
// this grid system is going to a be a bit more complex.
// in javascript, we can use a nested array, with each element holding a list of 
// what particle indices it occupies.
// However, in all glory gpu code, we dont have the luxury of dynamically sized nested arrays.
// The big problem is that the array needs to have a fixed sized at all times.

// This is less efficient than some other techniques, but for now, we are gonna take this approach:
// Essentially treating it like a 2d array but flattened down.
// Example: We declare how big each nested array is, lets say 10 elements.
// And then, we declare how many nested arrays we want, lets say 12 of those.
// The final array would have 120 elements, and the way we treat it is as if its a nested array,
// but to get each array inside of the big array, we do [big_index * 10 + small_index]
// For an example of what the array would look like,
// lets say we have two "nested" arrays and four elements per,
// with two items in the first array, and one item in the second.
// the final array would look something like this:
// [taken] [taken] [empty] [empty] [taken] [empty] [empty] [empty]
// I hope that makes sense!

// you can also imagine how this is going to be pretty inefficient at the least with memory because,
// in this case, with thousands of particles, and hundreds of grid spaces,
// theres gonna be A LOT of empty arrays.

// this stores how many slots are taken in each "nested" array
@group(0) @binding(6)
// the "atomic" makes each integer inside the array an atomic integer.
// atomic values dont run into race conditions, however you of course can't
// treat them like normal anymore. they special little snowflakes
var<storage, read_write> grid_cell_counts : array<atomic<u32>>;

// this is the big list of ACTUAL array contents of the "nested" arrays
@group(0) @binding(7)
var<storage, read_write> grid_cell_indices : array<u32>;

@group(0) @binding(9)
var<storage, read_write> particle_neighbors : array<u32>;


// vertex shaders can only *read* storage buffers. So we make another binding
@group(0) @binding(8)
var<storage, read> render_positions: array<vec2<f32>>;


// thats enough of the storage buffers. Remember we got these storage buffers simply because
// we need to write to them.
// But there are some properties that we *dont* want the gpu to write to, like constants
// for the simulation.
// That's what uniforms are for!
// notice we are using group 1 here. Just cause thats a nice way to organize it.
// group 0 is the readwrite buffers, group 1 is our uniforms!
@group(1) @binding(0)
var<uniform> settings: SimulationSettings;

// structs are like dictionaries/classes. Perfect for when we need to store a bunch of constants
// just do settings.gravity to get the gravity!
struct SimulationSettings {
    canvas_width : f32,
    canvas_height : f32,

    gravity : f32,
    physics_delta_time : f32,
    target_density : f32,
    border_damping : f32,
    air_damping : f32,

    pressure_coefficient : f32,
    viscosity_coefficient : f32,

    density_influence_radius : f32,
    pressure_influence_radius : f32,
    viscosity_influence_radius : f32,

    particle_radius : f32,
    particle_mass : f32,

    particle_amount : u32,

    // these technically arent simulation settings,
    // but it IS info that we want the simulation to have.

    // mouse
    mouse_x : f32,
    mouse_y : f32,
    mouse_clicking : u32,

    mouse_influence_radius : f32,
    mouse_strength : f32,

    // grid
    grid_cell_size : u32,
    grid_length_x : u32,
    grid_length_y : u32,
    grid_nested_length : u32,
}

const max_neighbors : u32 = 500;


@compute @workgroup_size(64)
fn instantiateGrid( @builtin(global_invocation_id ) id: vec3<u32>){
    // clear the grid variables
    let grid_cell_amount = settings.grid_length_x * settings.grid_length_y;
    if (id.x >= grid_cell_amount) { return; }
    // NOTICE we are only clearing the grid_cell_counts array
    // this is technically the only thing we need to do,
    // so that is good for performance.
    // later on, when we go through every particle,
    // we simply increase the ellement in grid_cell_counts by one
    // that corresponds to that cell.
    // it doesnt matter too much if the untouched grid_cell_indices
    // values are still hanging around.
    atomicStore(&grid_cell_counts[id.x], 0u);
}

@compute @workgroup_size(64)
fn doGrid( @builtin(global_invocation_id ) id: vec3<u32>){
    // put particles at the right element!
    // get this particle position
    let i = id.x;
    if (i >= settings.particle_amount) { return; }
    let position = positions[i];

    let grid_i = get_grid_cell_i_from_position(position);

    // atomiccc craziness
    // atomic add returns what the value USED to be
    // so this slot value is actually the index of what we want to override,
    // while it simultaneously increments the grid cell counts element!
    let slot = atomicAdd(&grid_cell_counts[grid_i], 1u);
    // put particle index in the right slot
    grid_cell_indices[grid_i * settings.grid_nested_length + slot] = i;
}

@compute @workgroup_size(64)
fn calculateNeighbors( @builtin(global_invocation_id) id: vec3<u32>){
    // here we are gonna calculate the neighbors of every particle
    // store them in the particle_neighbors buffer
    let i = id.x;
    if (i >= settings.particle_amount) { return; }

    let neighbors = get_neighbor_particles(positions[i]);
    for (var j = 0u; j < max_neighbors; j++){
        particle_neighbors[i * max_neighbors + j] = neighbors[j];
    }
}

@compute @workgroup_size(64)
fn calculateDensities( @builtin(global_invocation_id) id: vec3<u32>){
    let particle_i = id.x;

    // dont go past how many elements there are
    if (particle_i >= settings.particle_amount){ return; }

    // loop through neighbors
    var new_density = 0f;
    for (var j = 0u; j < max_neighbors; j++){
        let neighbor_i = particle_neighbors[particle_i * max_neighbors + j];
        // if invalid, out of neighbors, stop
        if (neighbor_i == u32_limit) { break; }
        let to_neighbor = positions[neighbor_i] - positions[particle_i];
        let magnitude = distance(vec2f(0,0), to_neighbor);
        // if not close enough, skip
        if (magnitude > settings.density_influence_radius) { continue; }
        new_density += settings.particle_mass * 
            SPHpoly6(magnitude, settings.density_influence_radius);
    }
    densities[particle_i] = new_density;
}

@compute @workgroup_size(64)
fn calculatePressures( @builtin(global_invocation_id) id: vec3<u32>){
    let particle_i = id.x;

    // dont go past how many elements there are
    if (particle_i >= settings.particle_amount){ return; }

    pressures[particle_i] = max(0,
        settings.pressure_coefficient * (densities[particle_i] - settings.target_density));
}

@compute @workgroup_size(64)
fn calculatePressureAccelerations( @builtin(global_invocation_id) id: vec3<u32>){
    let particle_i = id.x;

    // dont go past how many elements there are
    if (particle_i >= arrayLength(&pressures)){ return; }

    var pressure_acceleration = vec2f(0,0);
    // loop through all neighbors
    for (var j = 0u; j < max_neighbors; j++){
        let neighbor_i = particle_neighbors[particle_i * max_neighbors + j];
        // if invalid, out of neighbors, stop
        if (neighbor_i == u32_limit) { break; }
        let to_particle = positions[particle_i] - positions[neighbor_i];
        let magnitude = distance(vec2f(0,0), to_particle);
        // if not close enough or in the same spot, skip
        if (magnitude == 0 || magnitude > settings.pressure_influence_radius) { continue; }
        
        // lot of neat math stuff here but im not gonna bother on
        // commenting on a lot of it, for more information check out the cpu
        // version of this, fluidsim.js
        let gradient = SPHspikyGradient(to_particle, magnitude, settings.pressure_influence_radius);
        let pressure_term = (pressures[particle_i] + pressures[neighbor_i]) /
            (2 * densities[particle_i] * densities[neighbor_i]);
        pressure_acceleration.x += -settings.particle_mass * pressure_term * gradient.x;
        pressure_acceleration.y += -settings.particle_mass * pressure_term * gradient.y;
    }
    pressure_accelerations[particle_i].x = pressure_acceleration.x;
    pressure_accelerations[particle_i].y = pressure_acceleration.y;
}

@compute @workgroup_size(64)
fn calculateViscosityAccelerations( @builtin(global_invocation_id) id: vec3<u32>){
    let particle_i = id.x;

    // dont go past how many elements there are
    if (particle_i >= settings.particle_amount){ return; }

    var viscosity_acceleration = vec2f(0,0);
    // loop through all neighbors
    for (var j = 0u; j < max_neighbors; j++){
        let neighbor_i = particle_neighbors[particle_i * max_neighbors + j];
        // if invalid, out of neighbors, stop
        if (neighbor_i == u32_limit) { break; }

        let to_neighbor = positions[neighbor_i] - positions[particle_i];
        let magnitude = distance(vec2f(0,0), to_neighbor);
        // skip if on top or too far
        if (magnitude == 0 || magnitude >= settings.viscosity_influence_radius) { continue; }
        // viscosity scalar
        let laplacian = SPHlaplacian(magnitude, settings.viscosity_influence_radius);
        let velocity_difference = velocities[neighbor_i] - velocities[particle_i];

        let viscosity_term = settings.particle_mass / densities[neighbor_i] * laplacian;

        // apply
        viscosity_acceleration.x += settings.viscosity_coefficient * viscosity_term * velocity_difference.x;
        viscosity_acceleration.y += settings.viscosity_coefficient * viscosity_term * velocity_difference.y;
    }
    // yay
    viscosity_accelerations[particle_i] = viscosity_acceleration;
}

@compute @workgroup_size(64)
fn integrate( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= settings.particle_amount){ return; }

    // do mouse stuff
    if (settings.mouse_clicking == 1){
        // see if particle is close enough to mouse
        let to_mouse = vec2f(settings.mouse_x, settings.mouse_y) - positions[i];
        let magnitude = length(to_mouse);
        if (magnitude <= settings.mouse_influence_radius){
            velocities[i] += to_mouse * settings.physics_delta_time * settings.mouse_strength;
        }
    }

    // apply pressure acceleration
    velocities[i].x += pressure_accelerations[i].x * settings.physics_delta_time;
    velocities[i].y += pressure_accelerations[i].y * settings.physics_delta_time;

    // apply viscosity acceleration
    velocities[i].x += viscosity_accelerations[i].x * settings.physics_delta_time;
    velocities[i].y += viscosity_accelerations[i].y * settings.physics_delta_time;

    // gravity
    velocities[i].y += settings.gravity * settings.physics_delta_time;

    // air damping
    velocities[i].x *= settings.air_damping;
    velocities[i].y *= settings.air_damping;

    // apply velocities
    positions[i].x += velocities[i].x * settings.physics_delta_time;
    positions[i].y += velocities[i].y * settings.physics_delta_time;

    let min_distance = f32(settings.particle_radius);
    // if inside of another particle, push out
    // loop through all neighbors
    for (var j = 0u; j < max_neighbors; j++){
        let neighbor_i = particle_neighbors[i * max_neighbors + j];
        // if invalid, out of neighbors, stop
        if (neighbor_i == u32_limit) { break; }
        // if looking at self, continue
        if (i == neighbor_i) { continue; }

        var to_neighbor = positions[neighbor_i] - positions[i];
        let magnitude = distance(vec2f(0,0), to_neighbor);
        // if too far dont push out
        if (magnitude > min_distance) { continue; }
        // if on top of eachother we gotta make a vector
        if (magnitude == 0) 
        { 
            to_neighbor = vec2f(0,f32(i) * settings.physics_delta_time) * 0.1; 
        }
        // push out
        positions[i] -= 0;
    }

    // collide with borders
    // bottom
    if (positions[i].y + settings.particle_radius > settings.canvas_height){
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        velocities[i].y *= -1;
        positions[i].y = settings.canvas_height - settings.particle_radius - 1;
    }
        // left
    if (positions[i].x - settings.particle_radius < 0){
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        velocities[i].x *= -1;
        positions[i].x = settings.particle_radius + 1;
    }
    // right
    if (positions[i].x + settings.particle_radius > settings.canvas_width){
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        velocities[i].x *= -1;
        positions[i].x = settings.canvas_width - settings.particle_radius - 1;
    }
    // top
    if (positions[i].y - settings.particle_radius < 0){
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        velocities[i].y *= -1;
        positions[i].y = settings.particle_radius + 1;
    }
}


// rendering


@vertex
// vertex_index is the id of the draw call
// instance_index is the id of the triangle we are making (the particle basically)
fn vertex_main( 
    @builtin(vertex_index) vertex_index: u32, 
    @builtin(instance_index) instance_index: u32
) -> VertexOutput {

    var position = render_positions[instance_index];
    let offsets = array<vec2<f32>, 6>(
        // top right corner triangle
        vec2<f32>( settings.particle_radius, -settings.particle_radius),
        vec2<f32>( -settings.particle_radius, -settings.particle_radius),
        vec2<f32>( -settings.particle_radius, settings.particle_radius),
        // top left corner triangle
        vec2<f32>( settings.particle_radius, -settings.particle_radius),
        vec2<f32>( settings.particle_radius, settings.particle_radius),
        vec2<f32>( -settings.particle_radius, settings.particle_radius)
    );
    let offset = offsets[vertex_index];
    position.x += offset.x;
    position.y += offset.y;

    var clip_pos = canvas_position_to_clip_position(position);

    var output : VertexOutput;
    output.position = vec4<f32>(clip_pos.x, clip_pos.y, 0.0, 1.0);
    output.local_position = offset;
    output.color = vec4<f32>(0.1, 0.4, 0.8, 1.0);
    return output;
}

// THIS IS SO INTERESTING!!
// so we are basically passing in information from the vertex shader,
// of where (relative to the center) each vertex is.
// When this information is passed into the fragment shader,
// the gpu uses this vertex information to figure out where the current pixel is
// inside of the triangle that it is in!
// it then converts the passed in coordinates into where the current pixel is in screen space,
// relative to the triangle's (0,0).
@fragment
fn fragment_main(input : VertexOutput) -> @location(0) vec4<f32> {
    // check to see if this pixel is in the particle's circle
    let radius = settings.particle_radius;
    let magnitude = length(input.local_position);
    if (magnitude > radius){
        discard;
    }
    // stroke
    else if (magnitude > radius - 1){
        const darker_by : f32 = 0.2;
        return vec4<f32>(input.color.r - darker_by, input.color.g - darker_by, input.color.b - darker_by, input.color.a - darker_by);
    }

    return input.color;
}

// note: @location is basically just a communication channel that shaders can pass information with.
// so, the vertex shader sets @location(0)
// and then the fragment shader reads from @location(0). very simple.
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) local_position: vec2<f32>,
    @location(1) color: vec4<f32>,
}

fn canvas_position_to_clip_position(canvas_position : vec2<f32>) -> vec2<f32> {
    // we need to convert this canvas coordinate into a clip space coordinate
    // basically convert it into being normalized from -1 to 1
    var ret : vec2<f32>;
    ret.x = (canvas_position.x / settings.canvas_width) * 2.0 - 1.0;
    ret.y = (canvas_position.y / settings.canvas_height) * 2.0 - 1.0;
    ret.y *= -1.0;
    // clip space is y up
    return ret;
}


// grid functions

// FUCK FUCK FUCK this cant return a runtime sized array. theyre all fixed!!
// im just gonna leave this at 100. so, you can only get a maximum of 100 neighbor particles.
// that shouldnt be too bad!
// NOTE NOTE make sure to adjust all the 100s all the way down if you
// actually want to adjust that cap.
fn get_neighbor_particles(position : vec2<f32>) -> array<u32, max_neighbors>{
    let grid_cell_i = get_grid_cell_i_from_position(position);
    let neighbor_grid_cells = get_3x3_grid_cell_indices(grid_cell_i);
    let particle_indices = get_particle_indices_inside_3x3_cells(neighbor_grid_cells);
    return particle_indices;
}

fn get_grid_cell_i_from_position(position : vec2<f32>) -> u32{
    let grid_x = i32(floor(position.x / f32(settings.grid_cell_size)));
    let grid_y = i32(floor(position.y / f32(settings.grid_cell_size)));
    // clamp
    let clamped_x = clamp(grid_x, 0, i32(settings.grid_length_x) - 1);
    let clamped_y = clamp(grid_y, 0, i32(settings.grid_length_y) - 1);
    
    return u32(clamped_y) * settings.grid_length_x + u32(clamped_x);
}

const u32_limit = 0xFFFFFFFFu;
fn get_3x3_grid_cell_indices(grid_cell_i : u32) -> array<u32, 9>{
    var ret : array<u32, 9>;
    // fill the array with the unsigned 32 bit integer limit
    // this is just an easy way to say 4,294,967,295
    for (var i = 0u; i < 9u; i++){
        ret[i] = u32_limit;
    }
    // we do this because we need a way to know if a cell is invalid
    // in js, id usually do something like if it's negative 1 its invalid,
    // but here we are using unsigned ints! so instead we use the limit 
    // (its the next best thing lol)

    let x = grid_cell_i % settings.grid_length_x;
    let y = grid_cell_i / settings.grid_length_x;
    // remember these integer operations automatically floor

    // Reading order

    // check top
    if (y > 0){
        // top left
        // check left
        if (x > 0){
            ret[0] = grid_cell_i - settings.grid_length_x - 1;
        }
        // top middle
        ret[1] = grid_cell_i - settings.grid_length_x;
        // top right
        // check right
        if (x < settings.grid_length_x - 1){
            ret[2] = grid_cell_i - settings.grid_length_x + 1;
        }
    }

    // now middle

    // middle left
    // check left
    if (x > 0){
        ret[3] = grid_cell_i - 1;
    }
    // very middle
    ret[4] = grid_cell_i;
    // middle right
    // check right
    if (x < settings.grid_length_x - 1){
        ret[5] = grid_cell_i + 1;
    }

    // now bottom
    // check bottom
    if (y < settings.grid_length_y - 1){
        // bottom left left
        // check left
        if (x > 0){
            ret[6] = grid_cell_i + settings.grid_length_x - 1;
        }
        // bottom middle
        ret[7] = grid_cell_i + settings.grid_length_x;
        // bottom right
        // check right
        if (x < settings.grid_length_x - 1){
            ret[8] = grid_cell_i + settings.grid_length_x + 1;
        }
    }

    return ret;
}

fn get_particle_indices_inside_3x3_cells(grid_cells : array<u32, 9>) -> array<u32, max_neighbors>{
    var ret : array<u32, max_neighbors>;
    // fill ret with invalid indices
    for (var i = 0u; i < max_neighbors; i++){
        ret[i] = u32_limit;
    }

    var ret_i = 0u;
    for (var i = 0u; i < 9u; i++){
        let grid_i = grid_cells[i];
        // check if invalid
        if (grid_i == u32_limit) { continue; }

        let indices_nested_i = grid_i * settings.grid_nested_length;
        let nested_length = atomicLoad(&grid_cell_counts[grid_i]);
        for (var j = 0u; j < nested_length; j++){
            // dont exceed capacity
            if (ret_i >= max_neighbors) { break; }
            ret[ret_i] = grid_cell_indices[indices_nested_i + j];
            ret_i++;
        }
        if (ret_i >= max_neighbors) { break; }
    }
    return ret;
}


// funny math functions!!

const PI : f32 = 3.141592653589793;

// returns a scalar, mostly used for density
fn SPHpoly6(distance : f32, smoothing_radius : f32) -> f32{
    if (distance > smoothing_radius) { return 0.0; }
    let difference = smoothing_radius * smoothing_radius - distance * distance;
    return (4 / (PI * pow(smoothing_radius, 8))) * pow(difference, 3);
}
// returns a vector, mostly used for pressure force
// the direction does NOT have to be normalized. that is done here already
fn SPHspikyGradient(direction : vec2f, distance : f32, smoothing_radius : f32) -> vec2f{
    if (distance == 0 || distance > smoothing_radius) { return vec2f(0, 0); }
    let magnitude = (-30.0 / (PI * pow(smoothing_radius, 5))) * pow(smoothing_radius - distance, 2) / distance;
    return vec2f( direction.x * magnitude, direction.y * magnitude);
}
// returns a scalar that is commonly used for viscosity
fn SPHlaplacian(distance : f32, smoothing_radius : f32) -> f32{
    if (distance >= smoothing_radius) { return 0; }
    return (40 / (PI * pow(smoothing_radius, 5))) * (smoothing_radius - distance);
}