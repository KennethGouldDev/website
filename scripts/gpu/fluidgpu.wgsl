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

@group(0) @binding(8)
var<storage, read_write> grid_cell_starts : array<u32>;

@group(0) @binding(10)
var<storage, read_write> particle_slots : array<u32>;


@group(0) @binding(11)
var<storage, read_write> position_corrections : array<vec2<f32>>;

@group(0) @binding(12)
var<storage, read> rectangles : array<Rectangle>;

struct Rectangle {
    x : f32,
    y : f32,
    width : f32,
    height : f32,
    velocity_x : f32,
    velocity_y : f32,
    color_r : f32,
    color_g : f32,
    color_b : f32,
    selected : u32, // this will be 0 or 1
}

// vertex shaders can only *read* storage buffers. So we make another binding for purely reading
@group(2) @binding(0)
var<storage, read> read_positions: array<vec2<f32>>;
@group(2) @binding(1)
var<storage, read> read_velocities: array<vec2<f32>>;

@group(2) @binding(4)
var<storage, read> read_densities: array<f32>;

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

    // coloring
    color_mode : u32,
    color_sensitivity : f32,

    particle_min_distance : f32,

    resize_scale_x : f32,
    resize_scale_y : f32,

    rectangle_count : u32

}

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

// THE PLAN FOR THE GRID
// we are doing a technique that makes it so the indices array isnt going to be filled with a million
// empty slots anymore and clogging up the memory,
// instead we are going to have three arrays:
// an array saying where the starting index of each "nested" array is inside of the indices buffer
// an array saying what each particle's index is in its own nested array
// an array saying the amount of particles in each array
// so for each "nested" array we are storing where the array is, how long it is, and for each particle
// what it's index is inside the nested array
// with this, we can group up every particle and only have three arrays particle_amount long!


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

    // add to the grid_cell_counts thing to show how long that nested array is going to be
    // while simultaneously storing its old value to store what the index of this particle is
    // inside of its nested array
    particle_slots[i] = atomicAdd(&grid_cell_counts[grid_i], 1u);
}

// ---we are only using one thread for this because it is actually important to do this sequentially---
// HEY the above comment is now a LIE!!
// this is now becoming the bottleneck. we need to MULTITHREAD THIS!
// the main trick is that we are still only going to use one workgroup, so that each workgroup thread can communicate
// 256 threads here we go!!

// this is a variable that is shared by all the threads in the workgroup
var<workgroup> chunk_sums : array<u32, 256>;

@compute @workgroup_size(256)
// get where each nested array starts
fn doGridStarts( @builtin (local_invocation_id) id: vec3<u32>){
    let cell_amount = settings.grid_length_x * settings.grid_length_y;

    // step one,
    // split the amount of cells into chunks, so that each thread ( of the 256 ) 
    // gets a handful of elements to work with
    // the "+ 255u" is a simple trick to make the integer division round up instead of down
    let chunk_size = (cell_amount + 255u) / 256u;
    let start = id.x * chunk_size;
    // cap the ending for obv reasons
    let end = min(start + chunk_size, cell_amount);

    // add up how many particles are in my chunk
    var my_sum = 0u;
    for (var c = start; c < end; c++){
        my_sum += atomicLoad(&grid_cell_counts[c]);
    }
    chunk_sums[id.x] = my_sum;

    // this is the special sauce that waits until ALL the threads have written their sum
    workgroupBarrier();

    // NOW we have ONE thread turn all of the sums into start positions
    // this is fine because instead of one thread looping through every single cell,
    // now we just have a thread doing 256 operations
    // only make the first thread do this
    if (id.x == 0u){
        var total = 0u;
        for (var t = 0u; t < 256u; t++){
            let sum = chunk_sums[t];
            chunk_sums[t] = total;
            total += sum;
            // this is some elegant code that will convert the array being how many elements are in each,
            // into the starting index of each chunk ( if that makes sense idk )
        }
    }

    // everyone else waits for that one thread to be done
    workgroupBarrier();

    // start out at where this chunk starts at
    var running = chunk_sums[id.x];
    for (var c = start; c < end; c++){
        // now this is where we figure out where each element inside 
        // the chunk im responsible for starts
        grid_cell_starts[c] = running;
        running += atomicLoad(&grid_cell_counts[c]);
    }
}

@compute @workgroup_size(64)
fn gridPlaceParticles( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;
    if (i >= settings.particle_amount) { return; }

    let cell = get_grid_cell_i_from_position(positions[i]);
    // now we are gonna place the actual particle ids in the grid cell indices
    // based on the three other arrays we just established
    grid_cell_indices[grid_cell_starts[cell] + particle_slots[i]] = i;
}

@compute @workgroup_size(64)
fn calculateDensities( @builtin(global_invocation_id) id: vec3<u32>){
    let particle_i = id.x;

    // dont go past how many elements there are
    if (particle_i >= settings.particle_amount){ return; }

    let particle_position = positions[particle_i];

    var new_density = 0f;

    // loop through neighbors
    let this_cell = get_grid_cell_i_from_position(particle_position);
    let cell_x = i32(this_cell % settings.grid_length_x);
    let cell_y = i32(this_cell / settings.grid_length_x);
    // visit the 8 cells around this
    // just a lot of checks
    for (var dy = -1; dy <= 1; dy++){
        var cy = cell_y + dy;
        if (cy < 0 || cy >= i32(settings.grid_length_y)) { continue; }
        for (var dx = -1; dx <= 1; dx++){
            var cx = cell_x + dx;
            if (cx < 0 || cx >= i32(settings.grid_length_x)) { continue; }
            // the amount of neighbors we want to loop through is the looped cell's grid_cell_counts value
            var cell = u32(cy) * settings.grid_length_x + u32(cx);
            for (var j = 0u; j < atomicLoad(&grid_cell_counts[cell]); j++){
                let neighbor_i = grid_cell_indices[grid_cell_starts[cell] + j];
                
                // the actual function
                let to_neighbor = positions[neighbor_i] - positions[particle_i];
                let magnitude = distance(vec2f(0,0), to_neighbor);
                // if not close enough, skip
                if (magnitude > settings.density_influence_radius) { continue; }
                new_density += settings.particle_mass * 
                    SPHpoly6(magnitude, settings.density_influence_radius);

            }
        }
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
    if (particle_i >= settings.particle_amount){ return; }

    var pressure_acceleration = vec2f(0,0);
    // loop through all neighbors
    // loop through neighbors
    let this_cell = get_grid_cell_i_from_position(positions[particle_i]);
    let cell_x = i32(this_cell % settings.grid_length_x);
    let cell_y = i32(this_cell / settings.grid_length_x);
    // visit the 8 cells around this
    // just a lot of checks
    for (var dy = -1; dy <= 1; dy++){
        var cy = cell_y + dy;
        if (cy < 0 || cy >= i32(settings.grid_length_y)) { continue; }
        for (var dx = -1; dx <= 1; dx++){
            var cx = cell_x + dx;
            if (cx < 0 || cx >= i32(settings.grid_length_x)) { continue; }
            // the amount of neighbors we want to loop through is the looped cell's grid_cell_counts value
            var cell = u32(cy) * settings.grid_length_x + u32(cx);
            for (var j = 0u; j < atomicLoad(&grid_cell_counts[cell]); j++){
                let neighbor_i = grid_cell_indices[grid_cell_starts[cell] + j];

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
        }
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

    // loop through neighbors
    let this_cell = get_grid_cell_i_from_position(positions[particle_i]);
    let cell_x = i32(this_cell % settings.grid_length_x);
    let cell_y = i32(this_cell / settings.grid_length_x);
    // visit the 8 cells around this
    // just a lot of checks
    for (var dy = -1; dy <= 1; dy++){
        var cy = cell_y + dy;
        if (cy < 0 || cy >= i32(settings.grid_length_y)) { continue; }
        for (var dx = -1; dx <= 1; dx++){
            var cx = cell_x + dx;
            if (cx < 0 || cx >= i32(settings.grid_length_x)) { continue; }
            // the amount of neighbors we want to loop through is the looped cell's grid_cell_counts value
            var cell = u32(cy) * settings.grid_length_x + u32(cx);
            for (var j = 0u; j < atomicLoad(&grid_cell_counts[cell]); j++){
                let neighbor_i = grid_cell_indices[grid_cell_starts[cell] + j];

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
        }
    }
    // yay
    viscosity_accelerations[particle_i] = viscosity_acceleration;
}

@compute @workgroup_size(64)
fn calculatePositionCorrections( @builtin (global_invocation_id) id: vec3<u32>){
    let i = id.x;
    if (i >= settings.particle_amount){ return; }
    // if particles are wayy too close to eachother, then we manually push them apart!
    // experiment with this value
    
    // add up the corrections for every neighbor too close
    var correction = vec2f(0,0);

    // loop through neighbors
    // loop through neighbors
    let this_cell = get_grid_cell_i_from_position(positions[i]);
    let cell_x = i32(this_cell % settings.grid_length_x);
    let cell_y = i32(this_cell / settings.grid_length_x);
    // visit the 8 cells around this
    // just a lot of checks
    for (var dy = -1; dy <= 1; dy++){
        var cy = cell_y + dy;
        if (cy < 0 || cy >= i32(settings.grid_length_y)) { continue; }
        for (var dx = -1; dx <= 1; dx++){
            var cx = cell_x + dx;
            if (cx < 0 || cx >= i32(settings.grid_length_x)) { continue; }
            // the amount of neighbors we want to loop through is the looped cell's grid_cell_counts value
            var cell = u32(cy) * settings.grid_length_x + u32(cx);
            for (var j = 0u; j < atomicLoad(&grid_cell_counts[cell]); j++){
                let neighbor_i = grid_cell_indices[grid_cell_starts[cell] + j];

                // dont collide with ourselves
                if (neighbor_i == i) { continue; }

                var to_neighbor = positions[neighbor_i] - positions[i];
                var magnitude = length(to_neighbor);
                // skip if too far away
                if (magnitude >= settings.particle_min_distance) { continue; }

                // biggest problem comes when the particles are RIGHT on top of eachother.
                // in this case, the direction well, doesnt have a direction,
                // so we have to come up wit hour own direction

                // the important thing here, is that with this "made up" angle, both particles need to come up with their each angle
                // that point in the exact opposite direction.
                // We are making up this angle based on the particle's index value. In this case, we are going to choose the lesser
                // of the two index values so that both the particle and the neighbor come up with the same answer.
                // Depending on who it is, we just flip the magnitude
                if (magnitude < 0.001) {
                    // the funny number at the end is one i learned about and  found online, it is a special angle that will be very unique
                    // with every i value that we multiply it with. Most angles will loop pretty quickly, but this cool number
                    // will take a while to loop!
                    // and, funny enough, it is actually called the golden angle, and is derived with the golden ratio!!
                    // search it up it is awesome.
                    let made_up_angle = f32(min(i, neighbor_i)) * 2.39996;
                    let direction = vec2f(cos(made_up_angle), sin(made_up_angle));
                    // select function is like a quick if condition, kind of like the "?" operator
                    to_neighbor = select(-direction, direction, neighbor_i > i);
                    // we are gonna make our own magnitude
                    magnitude = 0;
                }

                // see how far we are inside eachother. this is set up so that bigger means we need to push eachother out more!
                let overlap = settings.particle_min_distance - magnitude;
                // move AWAY from the neighbor
                // divide by 2 because they only need to move away from eachother half as much
                correction -= normalize(to_neighbor) * overlap / 2;
            }
        }
    }
    // weve looped through it all

    // we want to be safe. make sure the correction vector isnt too long, we dont want to launch particles
    // accross the screen lol
    let correction_length = length(correction);
    if (correction_length > settings.particle_radius) {
        // normalize
        correction /= correction_length;
        // make it only as long as the radius of the particle
        correction *= settings.particle_radius;
    }

    position_corrections[i] = correction;
}

@compute @workgroup_size(64)
// make sure nothing in this loops over neighbors
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
    // make sure its the same depending on deltatime

    velocities[i].x *= pow(settings.air_damping, settings.physics_delta_time / (1.0/60.0));
    velocities[i].y *= pow(settings.air_damping, settings.physics_delta_time / (1.0/60.0));

    // position corrections
    positions[i] += position_corrections[i];

    // apply velocities
    positions[i].x += velocities[i].x * settings.physics_delta_time;
    positions[i].y += velocities[i].y * settings.physics_delta_time;

    // adjust position if the canvas is resized
    positions[i].x *= settings.resize_scale_x;
    positions[i].y *= settings.resize_scale_y;

    collide_with_rectangles(i);

    // collide with borders
    // bottom
    if (positions[i].y + settings.particle_radius > settings.canvas_height){
        velocities[i].y = -abs(velocities[i].y);
        velocities[i].y *= settings.border_damping;
        velocities[i].x *= settings.border_damping;
        positions[i].y = settings.canvas_height - settings.particle_radius;
    }
    // left
    if (positions[i].x - settings.particle_radius < 0){
        velocities[i].x = abs(velocities[i].x);
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        positions[i].x = settings.particle_radius;
    }
    // right
    if (positions[i].x + settings.particle_radius > settings.canvas_width){
        velocities[i].x = -abs(velocities[i].x);
        velocities[i].x *= settings.border_damping;
        velocities[i].y *= settings.border_damping;
        positions[i].x = settings.canvas_width - settings.particle_radius;
    }
    // top
    if (positions[i].y - settings.particle_radius < 0){
        velocities[i].y = abs(velocities[i].y);
        velocities[i].y *= settings.border_damping;
        velocities[i].x *= settings.border_damping;
        positions[i].y = settings.particle_radius;
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

    var position = read_positions[instance_index];
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

    // coloring
    if (settings.color_mode == 0){
        // velocity
        var velocity = read_velocities[instance_index];
        var velocity_magnitude = distance(vec2f(0,0), velocity);
        // for the color, interpolate from blue to green to red
        let color_a = vec4<f32>(0,0.2,1,1); // blue
        let color_b = vec4<f32>(0,0.8,0.2,1); // green
        let color_c = vec4<f32>(1,0,0,1); // red
        let t = clamp(velocity_magnitude/1000 * settings.color_sensitivity, 0, 1);
        let blend_term = mix(color_a, color_b, t * 2.0);
        let blend = mix(blend_term, color_c, t * 2.0 - 1.0);
        output.color = blend;
    }
    else if (settings.color_mode == 1){
        // density
        var density = read_densities[instance_index];
        // for the color, interpolate from blue to green to red
        let color_a = vec4<f32>(0,0.6,1,1); // blue
        let color_b = vec4<f32>(0,0.1,1,1); // green
        let color_c = vec4<f32>(1,0,0.3,1); // red
        let t = clamp(density * 50 * settings.color_sensitivity, 0, 10);
        let blend_term = mix(color_a, color_b, t * 2.0);
        let blend = mix(blend_term, color_c, t * 2.0 - 1.0);
        output.color = blend;
    }
    else{
        output.color = vec4<f32>(0,0.2,1,1);
    }
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
        return vec4<f32>(input.color.r - darker_by, input.color.g - darker_by, input.color.b - darker_by, input.color.a);
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


@vertex
fn vertex_rectangle(
    @builtin(vertex_index) vertex_index: u32,
    @builtin(instance_index) instance_index: u32
) -> RectangleVertexOutput {
    let rect = rectangles[instance_index];

    // make the two triangles that form a square
    let corners = array<vec2<f32>, 6>(
        // top left
        vec2<f32>(0, 0), vec2<f32>(1,0), vec2<f32>(0, 1),
        // bottom right
        vec2<f32>(1, 0), vec2<f32>(1, 1), vec2<f32>(0, 1)
    );
    // now we use these coords to form the rectangle
    let canvas_pos = vec2f(rect.x, rect.y) + (corners[vertex_index] * vec2f(rect.width, rect.height));
    let clip_pos = canvas_position_to_clip_position(canvas_pos);

    var color = vec3f(rect.color_r, rect.color_g, rect.color_b);

    if (rect.selected == 1u){
        // if it's selected, make it lighter
        color = mix(color, vec3f(1,1,1), 0.4);
    }

    var output : RectangleVertexOutput;
    output.position = vec4<f32>(clip_pos.x, clip_pos.y, 0, 1);
    output.color = color;
    let size = vec2f(rect.width, rect.height);
    output.local_position = corners[vertex_index] * size;
    output.size = size;
    return output;
}

@fragment
fn fragment_rectangle(input : RectangleVertexOutput) -> @location(0) vec4<f32>{
    // border
    let border_width = 5.0;

    // distance from this pixel to the four edges
    let to_left = input.local_position.x;
    let to_top = input.local_position.y;
    let to_right = input.size.x - input.local_position.x;
    let to_bottom = input.size.y - input.local_position.y;

    let closest_edge_distance = min(min(to_left, to_top), min(to_right, to_bottom));

    if (closest_edge_distance < border_width){
        return vec4<f32>(input.color * 0.5, 1.0);
    }
    
    return vec4<f32>(input.color, 1.0);
}

struct RectangleVertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color : vec3<f32>,
    // These two variables are so that we can add a border to the rectangles
    // it works similarly to what was done in the particle vertex and fragment shaders
    @location(1) local_position : vec2<f32>,
    @location(2) size : vec2<f32>,
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



fn collide_with_rectangles(i : u32){
    // loop through all rectangles
    for (var r = 0u; r < settings.rectangle_count; r++){
        let rect = rectangles[r];
        let rect_top_left = vec2f(rect.x, rect.y);
        let rect_bottom_right = vec2f(rect.x + rect.width, rect.y + rect.height);
        
        let position = positions[i];

        // theres some cool math that lets you figure out if a circle is inside of a rectangle
        // first we get the point of the rectangle that the particle is closest to
        // we can do this with, suprise, the clamping function!
        // this is genius man i cant believe i just found out about this
        let closest = clamp(position, rect_top_left, rect_bottom_right);
        let to_position = position - closest;
        // dot can be used as shorthand to get magnitude squared
        // its function is literally the left hand side of the pythagorean theorem
        let distance_squared = dot(to_position, to_position);

        // to check if the particle is touching, we just have to see if the particle is atleast closer than
        // the radius of the particle
        let radius = settings.particle_radius;
        if (distance_squared >= radius * radius) { continue; }

        // Not only do we have to calculate what direction to push the particle in,
        // In order to properly bounce the velocity, we have to calculate the surface normal!! yippee!!
        var normal = vec2f(0,0);

        if (distance_squared > 0){
            // this is what will normally happen, the center of the circle is OUTSIDE of the box
            // (but the circle touches it)
            let distance = sqrt(distance_squared);
            normal = to_position / distance;
            // move until we are properly one radius away from the survice
            positions[i] = closest + normal * radius;
        } else {
            // the particle is actually INSIDE of the box. this means we have to
            // find the nearest edge and then leave through that

            // find the distance the particle is from each edge
            let to_left = position.x - rect_top_left.x;
            let to_right = rect_bottom_right.x - position.x;
            let to_top = position.y - rect_top_left.y;
            let to_bottom = rect_bottom_right.y - position.y;
            // figure out which one the particle is closest to
            // literally just a huge min function
            let nearest = min(min(to_left, to_right), min(to_top, to_bottom));

            // now just a bunch of comparisons to see which one is the actual nearest
            // set the normal based on that,
            // and push the particle out based on that
            if (nearest == to_left){
                normal = vec2f(-1, 0);
                positions[i].x = rect_top_left.x - radius;
            } else if (nearest == to_right){
                normal = vec2f(1, 0);
                positions[i].x = rect_bottom_right.x + radius;
            } else if (nearest == to_top){
                normal = vec2f(0, -1);
                positions[i].y = rect_top_left.y - radius;
            } else if (nearest == to_bottom){
                normal = vec2f(0, 1);
                positions[i].y = rect_bottom_right.y + radius;
            }
        }
        // if the position is outside of bounds,

        // now we have to bounce the velocity!
        // that beautiful dot product is back at it again to make sure that
        // the particle is actually traveling INTO the box, and we arent reflecting
        // it even though the particle is moving away from it.
        // if it is negative, we are going INTO it.

        // we also have to apply the velocity of the rectangle itself to the particle
        // this is so when we move the rectangle around its like actually moving the particles
        // with it!
        // to do this we can actually very simply pass the velocity of the particle
        // relative to the rectangle. this makes it so that if the particle is stationary
        // and the rectangle is moving toward it, it acts as if the particle is moving
        // toward the rectangle. From there you can also imagine how other cases would work.
        // relativity is awesome!
        let rect_velocity = vec2f(rect.velocity_x, rect.velocity_y);
        let relative_velocity = velocities[i] - rect_velocity;
        let moving_toward = dot(relative_velocity, normal);
        if (moving_toward < 0){
            // doing some stuff here
            // subtracting from the velocity to slow it down/reflect it
            // multiplying by normal to make sure its only affecting the proper axis
            // multiplying by moving_toward so that the more *direct* the particle is moving
            // toward the edge, the more of an affect it will have
            // finally multiplying by the border damping constant
            velocities[i] -= normal * moving_toward * (1.0 + settings.border_damping);
        }
    }
}


// grid functions

// FUCK FUCK FUCK this cant return a runtime sized array. theyre all fixed!!
// im just gonna leave this at 100. so, you can only get a maximum of 100 neighbor particles.
// that shouldnt be too bad!
// NOTE NOTE make sure to adjust all the 100s all the way down if you
// actually want to adjust that cap.

// OLD neighbor functions, replaced them with more optimized stuff

// fn calculateNeighbors( @builtin(global_invocation_id) id: vec3<u32>){
//     // here we are gonna calculate the neighbors of every particle
//     // store them in the particle_neighbors buffer
//     let i = id.x;
//     if (i >= settings.particle_amount) { return; }

//     let neighbors = get_neighbor_particles(positions[i]);
//     for (var j = 0u; j < max_neighbors; j++){
//         particle_neighbors[i * max_neighbors + j] = neighbors[j];
//     }
// };

// fn get_neighbor_particles(position : vec2<f32>) -> array<u32, max_neighbors>{
//     let grid_cell_i = get_grid_cell_i_from_position(position);
//     let neighbor_grid_cells = get_3x3_grid_cell_indices(grid_cell_i);
//     let particle_indices = get_particle_indices_inside_3x3_cells(neighbor_grid_cells);
//     return particle_indices;
// }

fn get_grid_cell_i_from_position(position : vec2<f32>) -> u32{
    let grid_x = i32(floor(position.x / f32(settings.grid_cell_size)));
    let grid_y = i32(floor(position.y / f32(settings.grid_cell_size)));
    // clamp
    let clamped_x = clamp(grid_x, 0, i32(settings.grid_length_x) - 1);
    let clamped_y = clamp(grid_y, 0, i32(settings.grid_length_y) - 1);
    
    return u32(clamped_y) * settings.grid_length_x + u32(clamped_x);
}

// fn get_3x3_grid_cell_indices(grid_cell_i : u32) -> array<u32, 9>{
//     var ret : array<u32, 9>;
//     // fill the array with the unsigned 32 bit integer limit
//     // this is just an easy way to say 4,294,967,295
//     for (var i = 0u; i < 9u; i++){
//         ret[i] = u32_limit;
//     }
//     // we do this because we need a way to know if a cell is invalid
//     // in js, id usually do something like if it's negative 1 its invalid,
//     // but here we are using unsigned ints! so instead we use the limit 
//     // (its the next best thing lol)

//     let x = grid_cell_i % settings.grid_length_x;
//     let y = grid_cell_i / settings.grid_length_x;
//     // remember these integer operations automatically floor

//     // Reading order

//     // check top
//     if (y > 0){
//         // top left
//         // check left
//         if (x > 0){
//             ret[0] = grid_cell_i - settings.grid_length_x - 1;
//         }
//         // top middle
//         ret[1] = grid_cell_i - settings.grid_length_x;
//         // top right
//         // check right
//         if (x < settings.grid_length_x - 1){
//             ret[2] = grid_cell_i - settings.grid_length_x + 1;
//         }
//     }

//     // now middle

//     // middle left
//     // check left
//     if (x > 0){
//         ret[3] = grid_cell_i - 1;
//     }
//     // very middle
//     ret[4] = grid_cell_i;
//     // middle right
//     // check right
//     if (x < settings.grid_length_x - 1){
//         ret[5] = grid_cell_i + 1;
//     }

//     // now bottom
//     // check bottom
//     if (y < settings.grid_length_y - 1){
//         // bottom left left
//         // check left
//         if (x > 0){
//             ret[6] = grid_cell_i + settings.grid_length_x - 1;
//         }
//         // bottom middle
//         ret[7] = grid_cell_i + settings.grid_length_x;
//         // bottom right
//         // check right
//         if (x < settings.grid_length_x - 1){
//             ret[8] = grid_cell_i + settings.grid_length_x + 1;
//         }
//     }

//     return ret;
// }

// fn get_particle_indices_inside_3x3_cells(grid_cells : array<u32, 9>) -> array<u32, max_neighbors>{
//     var ret : array<u32, max_neighbors>;
//     // fill ret with invalid indices
//     for (var i = 0u; i < max_neighbors; i++){
//         ret[i] = u32_limit;
//     }

//     var ret_i = 0u;
//     for (var i = 0u; i < 9u; i++){
//         let grid_i = grid_cells[i];
//         // check if invalid
//         if (grid_i == u32_limit) { continue; }

//         let indices_nested_i = grid_i * settings.grid_nested_length;
//         let nested_length = atomicLoad(&grid_cell_counts[grid_i]);
//         for (var j = 0u; j < nested_length; j++){
//             // dont exceed capacity
//             if (ret_i >= max_neighbors) { break; }
//             ret[ret_i] = grid_cell_indices[indices_nested_i + j];
//             ret_i++;
//         }
//         if (ret_i >= max_neighbors) { break; }
//     }
//     return ret;
// }


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