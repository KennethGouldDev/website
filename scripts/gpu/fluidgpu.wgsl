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
@group(0) @binding(6)
var<storage, read_write> masses: array<f32>;
@group(0) @binding(7)
var<storage, read_write> radii: array<f32>;

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

    particle_amount : u32
}

@compute @workgroup_size(64)
fn calculateDensities( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= arrayLength(&densities)){ return; }

    densities[i] = f32(i);

    positions[i].y += 1;
}

@compute @workgroup_size(64)
fn calculatePressures( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= arrayLength(&pressures)){ return; }

    positions[i].y += 0;

}

@compute @workgroup_size(64)
fn calculatePressureAccelerations( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= arrayLength(&pressures)){ return; }


    
}

@compute @workgroup_size(64)
fn calculateViscosityAccelerations( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= arrayLength(&viscosity_accelerations)){ return; }


    
}

@compute @workgroup_size(64)
fn integrate( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;

    // dont go past how many elements there are
    if (i >= arrayLength(&positions)){ return; }

    positions[i].x += velocities[i].x * 0.01;
    positions[i].y += velocities[i].y * 0.01;
}


// rendering


@vertex
// vertex_index is the id of the draw call
// instance_index is the id of the triangle we are making (the particle basically)
fn vertex_main( 
    @builtin(vertex_index) vertex_index: u32, 
    @builtin(instance_index) instance_index: u32
) -> @builtin(position) vec4<f32> {
    let grav = settings.gravity;

    let position = render_positions[instance_index];
    var clip_pos = canvas_position_to_clip_position(position);

    let offsets = array<vec2<f32>, 3>(
        vec2<f32>( 0.0, 0.1),
        vec2<f32>( 0.1, -0.1),
        vec2<f32>( -0.1, -0.1)
    );
    let offset = offsets[vertex_index];
    clip_pos.x += offset.x;
    clip_pos.y += offset.y;

    return vec4<f32>(clip_pos.x, clip_pos.y, 0.0, 1.0);
}

@fragment
fn fragment_main() -> @location(0) vec4<f32> {
    let grav = settings.gravity;
    return vec4<f32>(0.0, 0.4, 1.0, 1.0);
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