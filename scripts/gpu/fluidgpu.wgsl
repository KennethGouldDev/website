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

@compute @workgroup_size(64)
fn main( @builtin(global_invocation_id) id: vec3<u32>){
    let i = id.x;
}