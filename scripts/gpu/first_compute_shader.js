// alrighty so first of all we need to make sure we can actually use the gpu

/** @type {GPUDevice | null} */
let device
async function initialize_gpu(){
    // navigator.gpu is the browser's entry point to the gpu
    if (!navigator.gpu){
        throw new Error("WebGPU is not supported yo... youre missing out on the cool fluid sim")
    }

    // an adapter is basically the GPU implementation that WebGPU can use
    // the browser automatically chooses an appropriate adapter
    // you can choose whether to use a more low-power or high-performance one
    // based on what you need
    const adapter =  await navigator.gpu.requestAdapter()

    if (!adapter){
        throw new Error("No GPU adapter man")
    }

    // finally this device is like the interface for actually interacting with the GPU
    device = await adapter.requestDevice()

    // we got the gpu!
}
async function do_shader(){
    // now we make the gpu buffer.

    const input_buffer = device.createBuffer({
        size: input_data.byteLength,
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_DST
    })
    // this syntax is weird, am i right?
    // we need to clarify the size of the buffer we want to make. this is in bytes.
    // in this case, we just use however many bytes the input data takes up.

    // GPUBufferUsage.Storage clarifies that we want to use this buffer for storage
    // (btw, saying its storage doesnt declare if we can read or write it)
    // GPUBufferUsage.COPY_DST lets us copy data INTO the buffer
    // the single `|` you see is just a bitwise OR. these usage fllgs are actually bitmasks.

    // upload it

    device.queue.writeBuffer(
        input_buffer,
        0,
        input_data
    )
    // writeBuffer takes in the destination buffer, offset, and data to upload.

    // Awesome! Now the input array we made is now in the GPU memory.

    // Now we need a way to send the data back.

    const output_buffer = device.createBuffer({
        size: input_data.byteLength,
        usage:
            GPUBufferUsage.STORAGE |
            GPUBufferUsage.COPY_SRC
    })
    // we make another buffer identical to the other one,
    // however you may notice now we use COPY_SRC so we can copy data OUT of the buffer.

    // Now we load in the shader code
    // the .then just converts the response into text
    const shader_code = await fetch("../scripts/first_compute_shader.wgsl")
        .then(response => response.text())
    
    // now we make a shader module.
    // a shader module simply contains the wgsl code that WebGPU validates and compiles.
    const shader_module = device.createShaderModule({
        code: shader_code
    })

    // WebGPU is generally handled by the adapter from earlier,
    // so creating the module doesnt mean ALL of the compilation work is finished.

    // basically we should check for errors
    const compilation_info = await shader_module.getCompilationInfo()
    // print out all the info
    for (const message of compilation_info.messages){
        console.log(message.message)
    }
    // throw an error if there is an error
    if (compilation_info.messages.some(message => message.type == "error")){
        throw new Error("Shader compilation failed!!!")
    }

    
    // Okay okay, now we have the shader module, but we havent told WebGPU
    // how we are gonna use it.
    // So we make a compute pipeline
    const compute_pipeline = device.createComputePipeline({
        layout: "auto",
        compute: {
            module: shader_module,
            entryPoint: "main"
        }
    })
    // `layout: "auto"` automatically determines what resource layout to use
    // based on what has been declared. very convenient *for now*, but you might
    // want to define the explicit layout once things get more complicated and
    // you want more optimization.
    // We use the shader module we just loaded, and IMPORTANTLY,
    // `entryPoint: "main"` tells the gpu which function to execute.
    // this is useful because, for something like a fluid simulation, we are
    // gonna be using multiple compute shaders in one module.

    // the shader has binding 0: input and binding 1: output,
    // but the gpu doesnt know what actual gpu buffers those are.
    const bind_group = device.createBindGroup({
        layout: compute_pipeline.getBindGroupLayout(0),
        entries: [
            {
                binding: 0,
                resource: {
                    buffer: input_buffer
                }
            },
            {
                binding: 1,
                resource: {
                    buffer: output_buffer
                }
            }
        ]
    })

    
    // Okay okay, NOW, we actually dispatch the compute shader!

    // create an object for recording the GPU commands
    const command_encoder = device.createCommandEncoder()
    // begin the compute pass. This is where we give the commands
    const compute_pass = command_encoder.beginComputePass()
    compute_pass.setPipeline(compute_pipeline)
    compute_pass.setBindGroup(0, bind_group)
    // THIS is the actual dispatch. 
    // Telling how many workgroups for the GPU to execute.
    // we do some math to figure out how many workgroups to give.
    // in this example, we only have 5 elements.. so its only gonna send one workgroup.
    compute_pass.dispatchWorkgroups(
        Math.ceil(input_data.length / 64)
    )
    compute_pass.end()

    // finally submit the commands to the gpu queue.
    device.queue.submit([
        command_encoder.finish()
    ])

    // ALRIGHT, so it is doing the script, but now we need to actually
    // make it so we can get the results back.
    // WE NEED TO BE CAREFUL because remember the gpu is just soooo asyncronous.
    // Javascript cant *just* access the gpu's memory, so we need to
    // copy the output into a _readback buffer_.
    const readback_buffer = device.createBuffer({
        size: output_buffer.size,
        usage:
            GPUBufferUsage.COPY_DST |
            GPUBufferUsage.MAP_READ
    })
    // the buffer is NO LONGER marked as STORAGE because it is not
    // intended to be used by our compute shader
    // its specificallly for our javascript

    // copy our readback
    const readback_encoder = device.createCommandEncoder()

    // the arguments are: source buffer, source offset,
    // destination buffer, destination offset,
    // number of bytes to copy.
    readback_encoder.copyBufferToBuffer(
        output_buffer,
        0,
        readback_buffer,
        0,
        output_buffer.size
    );
    // so as you can see, we are just copying the output to our read buffer

    device.queue.submit([
        readback_encoder.finish()
    ])

    // now this is the moment where we finally wait for the gpu to do its thing!

    await readback_buffer.mapAsync(GPUMapMode.READ)
    // Now the output buffer contains our answer!

    // get the result!
    const result = new Float32Array(
        readback_buffer.getMappedRange()
    ).slice()
    //.slice() makes it a new array with the values that it has. 
    // its like godot's .copy()
    // this is important because once we unmap the buffer,
    // we cant get the value anymore unless we store it in a javascript variable

    // now we unmap the buffer
    readback_buffer.unmap()

    return result
}

await initialize_gpu()

// for this simple program, we are gonna give an array of numbers
// and ask for the gpu to add 1 to every number in parallel

// the normal javascript number uses 64 bits.
// However, shader code uses 32 bits.
// so we are gonna use *specifically* float 32 bit numbers
let input_data = new Float32Array([
    5, 10, 15, 20, 25
])


await do_shader()

input_data = new Float32Array([
    50, 40, 30, 20, 10, 0, -10, -20
])

await do_shader()