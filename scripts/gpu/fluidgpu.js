/** @type {GPUDevice | null} */
let device

// get background canvas
/** @type {HTMLCanvasElement} */
const background_canvas = document.getElementById("background");
// this gets the canvas' drawing api. think of this variable, `ctx`, as your drawing tool
const ctx = background_canvas.getContext("2d");

let particle_amount = 100

// these are things that can change per particle.
// We will put these in their own buffers
let positions = [];
let velocities = [];
let densities = [];
let pressures = []
let pressure_accelerations = []
let viscosity_accelerations = []
let masses = [];
let radii = [];
// These are constants/parameters that *dont* change per particle.
// These we will instead put into a uniform buffer
let gravity = 500
let target_density = 1
let border_damping = 0.95
let air_damping = 0.995

let pressure_coefficient = 10
let viscosity_coefficient = 50

let density_influence_radius = 60
let pressure_influence_radius = 50
let viscosity_influence_radius = 60

// ----------------------------------------------- INITIALIZE

// create particle data
create_particle_data()

await initialize_gpu()

// we are gonna make a dictionary of all the gpu buffers we gon use
let gpu_buffers = {}
let readback_buffers = {}

initialize_buffers()

// get the actual scripts
await initialize_shaders()

let pipelines = {
    density: null,
    pressure: null,
    viscosity: null,
    // integration is just gonna be actually applying forces
    integration: null
}
intialize_pipelines()

initialize_bind_groups()



// ------------------------------------------------- COMPUTE


// connect the buffers to the shader bindings

// ------------------------------------------------------ READBACK

copy_gpu_data_to_readback()
let data = await get_gpu_particle_data()
console.log(data.densities)

// ------------------------------------------------------ RENDER


function create_particle_data(){
    let root = Math.ceil(Math.sqrt(particle_amount))
    for (let i = 0; i < particle_amount; i++){
        // spawn them in a grid formation

        let pos_x = background_canvas.width/2
        let offset_x = -root/2
        offset_x += i % root
        pos_x += offset_x * 20
        pos_x += (Math.random() - 0.5) * 10
        let pos_y = background_canvas.height/2
        let offset_y = -root/2
        offset_y += Math.floor(i / root)
        pos_y += offset_y * 20
        pos_y += (Math.random() - 0.5) * 10
        positions.push({x: pos_x, y: pos_y})
        velocities.push({x: 0, y: 0})
        densities.push(0)
        pressures.push(0)
        pressure_accelerations.push({x: 0, y: 0})
        viscosity_accelerations.push({x: 0, y: 0})
        masses.push(1)
        radii.push(10)

        // random velocity
        let rand_vel = 0
        velocities[i].x = randf_range(-rand_vel, rand_vel)
        velocities[i].y = randf_range(-rand_vel, rand_vel)
    }
}

function randf_range(a, b){
    return (a + Math.random() * (b - a))
}

async function initialize_gpu(){
    // check if we can use gpu
    if (!navigator.gpu){
        throw new Error("WebGPU not supported man :( Try a different browser")
    }
    // get implementation
    const adapter = await navigator.gpu.requestAdapter()
    if (!adapter){
        throw new Error("No GPU adapter")
    }

    // get device (interface)
    device = await adapter.requestDevice()
}

// function to create a storage buffer for the gpu.
// we are gonna have multiple buffers for each of the particle datas
// that we want to keep track of, so lets wrap it in a function!
function create_storage_buffer(data){
    // make
    const buffer = device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC
    })
    // we assume that all of them are storage,
    // and also that we want to be able to read and write
    // to all of them.
    // We wont have to read/write from *all* of them, but this
    // will make it easier to debug.

    // write
    if (data.byteLength > 0){
        device.queue.writeBuffer(buffer, 0, data)
    }

    return buffer
}

// notice how this turns into a float32 array where every
// other element is the y value. thats how we will be passing in
// vec2 information; WGSL uses array<vec2<f32>> where every element is
// an array of 2 component vectors with 32bit floats.
function convert_vector_array_to_packed(vectors){
    const ret = new Float32Array(vectors.length * 2)

    for (let i = 0; i < vectors.length; i++) {
        ret[i * 2] = vectors[i].x
        ret[i * 2 + 1] = vectors[i].y
    }
    return ret
}
// do it backwards
function convert_packed_to_vector_array(data){
    const ret = []

    for (let i = 0; i < data.length; i += 2) {
        ret.push({
            x: data[i] ,
            y: data[i + 1]
        })
    }
    return ret
}

function initialize_buffers(){
    // convert all the variables into gpu friendlly
    const position_data = convert_vector_array_to_packed(positions)
    const velocity_data = convert_vector_array_to_packed(velocities)
    const pressure_acceleration_data = convert_vector_array_to_packed(pressure_accelerations)
    const viscosity_acceleration_data = convert_vector_array_to_packed(viscosity_accelerations)
    const mass_data = new Float32Array(masses)
    const radius_data = new Float32Array(radii)
    const density_data = new Float32Array(densities)
    const pressure_data = new Float32Array(pressures)

    // create the gpu buffers!
    gpu_buffers = {
        positions: create_storage_buffer(position_data),
        velocities: create_storage_buffer(velocity_data),
        pressure_accelerations: create_storage_buffer(pressure_acceleration_data),
        viscosity_accelerations: create_storage_buffer(viscosity_acceleration_data),
        masses: create_storage_buffer(mass_data),
        radii: create_storage_buffer(radius_data),
        densities: create_storage_buffer(density_data),
        pressures: create_storage_buffer(pressure_data),
    }

    // create the readback buffers!
    readback_buffers = {
        positions: create_readback_buffer(gpu_buffers.positions),
        velocities: create_readback_buffer(gpu_buffers.velocities),
        pressure_accelerations: create_readback_buffer(gpu_buffers.pressure_accelerations),
        viscosity_accelerations: create_readback_buffer(gpu_buffers.viscosity_accelerations),
        masses: create_readback_buffer(gpu_buffers.masses),
        radii: create_readback_buffer(gpu_buffers.radii),
        densities: create_readback_buffer(gpu_buffers.densities),
        pressures: create_readback_buffer(gpu_buffers.pressures),
    }
}

// this function is used as shorthand for the initialize_buffers() function
function create_readback_buffer(source_buffer){
    // We want to get the values from the compute shader back into our javascript.
    // However, we can't map from a buffer the gpu is currently using.
    // So, we copy the gpu buffer data into a special buffer that javascript *can* read.
    return device.createBuffer({
        size: source_buffer.size,
        usage:
            GPUBufferUsage.COPY_DST |
            // lets us copy a buffer into this one
            GPUBufferUsage.MAP_READ
            // lets javascript map and read the buffer
            // notice there is no STORAGE because we dont need
            // the shader to read the buffer
    })
}

function copy_gpu_data_to_readback(){
    const encoder = device.createCommandEncoder()
    // loop through all the keys of the readback and make them store the
    // gpu buffer data
    // `Object.keys` is simply a function that returns 
    // all the keys of a dictionary as an array
    for (const key of Object.keys(readback_buffers)){
        encoder.copyBufferToBuffer(
            gpu_buffers[key], 0,
            readback_buffers[key], 0,
            gpu_buffers[key].size
        )
    }
    // submit these commands
    device.queue.submit([encoder.finish()])
}

async function read_gpu_buffer(readback_buffer){
    // wait until the gpu is done writing to this buffer
    await readback_buffer.mapAsync(GPUMapMode.READ)
    // map
    const mapped_ranged = readback_buffer.getMappedRange()
    // make javascript copy of data
    const ret = new Float32Array(mapped_ranged.slice(0))
    // unmap
    readback_buffer.unmap()

    return ret
}

// one function to get all of the particle data!
async function get_gpu_particle_data(){
    const keys = Object.keys(readback_buffers)

    const values = await Promise.all(
        keys.map(key => read_gpu_buffer(readback_buffers[key]))
    )

    const ret = Object.fromEntries(
        keys.map((key, i) => [key, values[i]])
    )

    // convert the data back into their normal javascript objects
    ret.positions = convert_packed_to_vector_array(ret.positions)
    ret.velocities = convert_packed_to_vector_array(ret.velocities)
    ret.pressure_accelerations = convert_packed_to_vector_array(ret.pressure_accelerations)
    ret.viscosity_accelerations = convert_packed_to_vector_array(ret.viscosity_accelerations)
    return ret
}

async function initialize_shaders(){
    // make the shader modules
    const shader_code = await fetch("../scripts/gpu/fluidgpu.wgsl")
        .then(response => response.text())
    
    // simply convert the .wgsl into actual shader code
    const shader_module = device.createShaderModule({
        code: shader_code
    })

    // check for errors ( i hear they can be annoying down the line )
    const compilation_info = await shader_module.getCompilationInfo()

    for (const message of compilation_info.messages){
        console.log(message.type, message.message)
    }

    return shader_module
    
    // from what I hear, we dont necessarily need a different wgsl file for every stage,
    // we just declare different entry points.
}

function intialize_pipelines(){

}

function initialize_bind_groups(){

}
