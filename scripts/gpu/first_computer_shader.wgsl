@group(0) @binding(0)
var<storage, read> input_data: array<f32>;

@group(0) @binding(1)
var<storage, read_write> output_data: array<f32>;

// lots of scary syntax.
// A group is a collection (group) of resources that are bound together
// A binding is the particular resource in that group
// so simply there are groups, and in each group is a binding and thats where we can put our information.

// var declares a variable that represents that storage buffer
// we declare what kind of variable it is, what we can do with it, and it's value type
// in this case its a storage variable, we can either only read or can read and write from it,
// and we declared that its a float 32 bit array.
// Take note that we dont have to say how big the array is, runtime-sized arrays
// still work in wgsl, and is the fallback if no array length is given, like here.

// now we actually write the compute shader

// Workgroups are important to understand.
// You can think of every workgroup as 64 invocations/threads, and each
// invocation is one execution of our function.

// The GPU separates and schedules workgroups seperately in the actual hardware.
// workgroups are ALSO useful because invocations in the same workgroup can
// actually communicate with eachother through a shared workgroup memory and sync!
@compute @workgroup_size(64)
// the @ symbols btw, are declarations of attributes. it basically tells the
// code what we are doing.
// @builtin in this case tells the gpu to give this function information from the gpu,
// in this case it asks to pass in `global_invocation_id`.
// it gives the global position/id of this invocation across the entire dispatch.

// IDs are actually really important to understand,
// its in a vec3 because you can dispatch work in up to three dimensions.
// this is useful in the examples of:
// processing a particle array (one dimension)
// processing an image (two dimensions)
// processing a volume (three dimensions)
// in order to dispatch 3d workgroups, youd do something like
// compute_pass.dispatchWorkgroups(10, 8, 20);
// thats why they give us three components
// global id is the most common used value. it is basically:
// workgroup id * workgroup size + local id
// thats how basically now every thread has its own unique number in the overall dispatch

// and of course, we want to use global_invocation_id here because it lets us know
// what element to give each thread.

// when i say thread here, its an analogy. Invocations are its own gpu thing,
// dont get them mixed up with CPU threads.

fn main( @builtin(global_invocation_id) id: vec3<u32>){

    let i = id.x;
    
    // 64 workgroups is a lot. we only have five data points
    // so we need to make sure we dont accidentally try to access more items 
    // than we actually have
    
    // the `&` operator is the reference operator
    // arrayLength gives the number of elements in a runtime-sized array
    // It expects a pointer to an array, not the array itself, so we use the &
    // oprator to give the reference to `input_data` rather than it's actual value
    if (i >= arrayLength(&input_data)) { return; }

    output_data[i] = input_data[i] + 3.5;

}
// Thats the shader!