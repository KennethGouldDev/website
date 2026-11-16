// alrighty so first of all we need to make sure we can actually use the gpu

/** @type {GPUDevice | null} */
let device
async function initialize_gpu(){
    // navigator.gpu is the browser's entry point to the gpu
    if (!navigator.gpu){
        throw new Error("WebGPU is not supported yo... youre missing out on the cool fluid sim")
    }

    // an adapter is simply the GPU Implementation that is going to be used with your gpu
    // the browser automatically chooses an appropriate adapter
    const adapter =  await navigator.gpu.requestAdapter()

    if (!adapter){
        throw new Error("No GPU adapter man")
    }

    // finallly this device is like the interface for actually interacting with the GPU
    device = await adapter.requestDevice()
}
await initialize_gpu()
console.log("Got the gpu! gpu:", device)

// for this simple program, we are gonna give an array of numbers
// and ask for the gpu to add 1 to every number in parallel

// the normal javascript number uses 64 bits.
// However, shader code uses 32 bits.
// so we are gonna use *specifically* float 32 bit numbers
const input_data = new Float32Array([
    5, 10, 15, 20, 25
])

// now we make the gpu bufer.

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
