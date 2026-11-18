/** @type {GPUDevice | null} */
let device

// ------------------------------------------ CANVAS
/** @type {HTMLCanvasElement} */
const background_canvas = document.getElementById("background");
// get the webgpu canvas context (its like the webgpu equivalent of ctx)
/** @type {GPUCanvasContext} */
const webgpu_context = background_canvas.getContext("webgpu")

// this gets initialized with the gpu
let gpu_canvas_format
// this get initialized with the pipelines
let gpu_render_pipeline

// make the canvas match the window size
background_canvas.width = window.innerWidth;
background_canvas.height = window.innerHeight;

// make it so the background canvas resizes whenever the window gets resized
window.addEventListener("resize", () =>{
    let width_delta = window.innerWidth - background_canvas.width
    let height_delta = window.innerHeight - background_canvas.height
    background_canvas.width = window.innerWidth;
    background_canvas.height = window.innerHeight;

    // TODO we should  update the particle positions
    // when we resize the window. We need to do that on
    // gpu tho.
})

// track mouse
let mouse = {
    x: 0,
    y: 0
}
window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
})

// get if the mouse is clicked
let clicking = false

document.addEventListener("mousedown", () =>{
    clicking = true
})
document.addEventListener("mouseup", () =>{
    clicking = false
})

// --------------------------------------------- FLUID SIM

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
let physics_delta_time = 1.0/60.0;

let pressure_coefficient = 10
let viscosity_coefficient = 50

let density_influence_radius = 60
let pressure_influence_radius = 50
let viscosity_influence_radius = 60

// GPU!!!
// ----------------------------------------------- INITIALIZE

// create particle data
create_particle_data()

await initialize_gpu()

// we are gonna make a dictionary of all the gpu buffers we gon use
let gpu_buffers = {}
let readback_buffers = {}

initialize_buffers_with_data()
let uniform_data
let uniform_floats
let uniform_uints
let uniform_buffer
initialize_uniform_buffer()

// get the actual scripts
let shader_module = await initialize_shaders()

let pipelines = {
    density: null,
    pressure: null,
    viscosity: null,
    // integration is just gonna be actually applying forces
    // and also all the other stuff
    integration: null
}

initialize_pipelines()

let bind_groups = initialize_bind_groups()

// ------------------------------------------------------ READBACK

copy_gpu_data_to_readback()
let data = await get_gpu_particle_data()
// feed it back into the variables
apply_gpu_particle_data(data)
console.log(data.positions)

// ------------------------------------------------------ RENDER

let prev_timestamp = 0
let physics_accumulate = 0;

let requesting_readback  = false
requestAnimationFrame(animate)
function animate(timestamp){
    // requestAnimationFrame doesnt give deltatime, instead it gives a timestamp.
    // with this, we can calculate deltatime though.
    // NOTE timestamp is in milliseconds, thats why we divide by 1000 here
    let delta = (timestamp - prev_timestamp) / 1000;
    prev_timestamp = timestamp
    let time = timestamp/1000;

    // do physics process
    // some trickery to make sure it runs at a fixed timestep
    physics_accumulate += delta
    while (physics_accumulate > physics_delta_time) {
        if (physics_accumulate > physics_delta_time * 10){
            // dont make it execute more than ten times in one frame
            physics_accumulate = 0
            break
        }
        physics_accumulate -= physics_delta_time
        physics_process(physics_delta_time, time)
    }

    render_gpu()

    requestAnimationFrame(animate)
}

function render_gpu(){
    // make command encoder
    const command_encoder = device.createCommandEncoder()

    // get the canvas texture (basically the image we are about to draw onto)
    const texture = webgpu_context.getCurrentTexture()

    // begin the render pass
    const render_pass = command_encoder.beginRenderPass({
        // this is where the render pass gets configured
        colorAttachments: [{
            // the view describes how the texture is accessed by the GPU operations
            view: texture.createView(),
            clearValue: { r: 0, g: 0, b: 0, a: 1 },
            // clear the previous image before drawing
            loadOp: "clear",
            // preserve the result when done
            storeOp: "store"
        }]
    })

    render_pass.setPipeline(gpu_render_pipeline)
    render_pass.setBindGroup(0, bind_groups.vertex_bind_group)
    render_pass.setBindGroup(1, bind_groups.render_settings_bind_group)
    // draw three vertices for each particle
    // the arguments are: Vertex count, Instance amount
    // so, draw particle_amount objects with 3 vertices
    render_pass.draw(3, particle_amount)

    render_pass.end()

    device.queue.submit([command_encoder.finish()])
}

// this is more of a debug function that renders all the particles
// with the cpu
async function render_on_cpu(){
    copy_gpu_data_to_readback()
    let data = await get_gpu_particle_data()
    apply_gpu_particle_data(data)

    // clear previous frame
    ctx.clearRect(0,0, background_canvas.width, background_canvas.height)

    // draw particles
    for (let i = 0; i < particle_amount; i++) {
        // draw circle
        ctx.beginPath();
        ctx.arc(positions[i].x, positions[i].y, radii[i], 
            0, 2 * Math.PI)
        ctx.fillStyle = "rgb(50, 50, 255)"
        ctx.fill()
        ctx.strokeStyle = "rgba(50,50,150,0.8)"
        ctx.lineWidth = 4;
        ctx.stroke();
    }
}

// PHYSICS PROCESS

function physics_process(delta, time){
    // update settings
    update_uniform_buffer()

    let workgroup_size = 64

    // create an object for recording the GPU commands
    const command_encoder = device.createCommandEncoder()
    // begin the compute pass. This is where we give the commands
    const compute_pass = command_encoder.beginComputePass()

    // density
    compute_pass.setPipeline(pipelines.density)
    compute_pass.setBindGroup(0, bind_groups.calculateDensity_bind_group)
    compute_pass.dispatchWorkgroups( Math.ceil(particle_amount / workgroup_size))

    // pressure
    compute_pass.setPipeline(pipelines.pressure)
    compute_pass.setBindGroup(0, bind_groups.calculatePressures_bind_group)
    compute_pass.dispatchWorkgroups( Math.ceil(particle_amount / workgroup_size))

    // integrate
    compute_pass.setPipeline(pipelines.integrate)
    compute_pass.setBindGroup(0, bind_groups.integrate_bind_group)
    compute_pass.dispatchWorkgroups( Math.ceil(particle_amount / workgroup_size))

    compute_pass.end()

    // finally submit the commands to the gpu queue.
    device.queue.submit([
        command_encoder.finish()
    ])
}

// ------------------------------------------------------ FUNCTIONS

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

    // make it so if theres an error we can catch it
    // sometimes webgpu errors can be sneaky
    device.addEventListener("uncapturederror", (event) => {
        console.error("WebGPU Error: ", event.error)
    })
    
    // initialize the canvas so we can draw
    gpu_canvas_format = navigator.gpu.getPreferredCanvasFormat()

    webgpu_context.configure({
        device: device,
        format: gpu_canvas_format,
        // determines how the transparency is handled. this is just a common choice
        alphaMode: "premultiplied"
    })
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

function initialize_buffers_with_data(){
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


function initialize_uniform_buffer(){
    uniform_buffer = device.createBuffer({
        // its important to determine the write size of
        // our uniform buffer. We use 64 bytes here because
        // we have around 50 bytes worth of variables
    size: 64,
    usage: 
        GPUBufferUsage.UNIFORM |
        GPUBufferUsage.COPY_DST
    })

    // make an array buffer with 32 bytes
    // this a javascript trick.
    // uniform_floats and uniform_uints reference the same underlying array,
    // which is uniform_data.
    // However, modifying uniform_floats will give uniform_data a float32,
    // and modifying uniform_uints will give uniform_data an uint32
    uniform_data = new ArrayBuffer(64)
    uniform_floats = new Float32Array(uniform_data)
    uniform_uints = new Uint32Array(uniform_data)
}
function update_uniform_buffer(){
    uniform_floats[0] = background_canvas.width
    uniform_floats[1] = background_canvas.height

    uniform_floats[2] = gravity
    uniform_floats[3] = physics_delta_time

    uniform_floats[4] = target_density
    uniform_floats[5] = border_damping
    uniform_floats[6] = air_damping

    uniform_floats[7] = pressure_coefficient
    uniform_floats[8] = viscosity_coefficient

    uniform_floats[9] = density_influence_radius
    uniform_floats[10] = pressure_influence_radius
    uniform_floats[11] = viscosity_influence_radius

    uniform_uints[12] = particle_amount

    // write to the uniform buffer
    device.queue.writeBuffer(
        uniform_buffer, 0,
        uniform_data
    )
}



// this function is used as shorthand for the initialize_buffers_with_data() function
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
function apply_gpu_particle_data(data){
    positions = data.positions
    velocities = data.velocities
    pressure_accelerations = data.pressure_accelerations
    viscosity_accelerations = data.viscosity_accelerations

    densities = data.densities
    pressures = data.pressures
    masses = data.masses
    radii = data.radii
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

// create the pipelines ( basically what code are we gonna be executing,
// what commands do we actually wanna give to the gpu )
function initialize_pipelines(){
    pipelines.density =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "calculateDensities"
            }
        }),
    pipelines.pressure =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "calculatePressures"
            }
        }),
    pipelines.pressureAccelerations =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "calculatePressureAccelerations"
            }
        })
    pipelines.viscosityAccelerations =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "calculateViscosityAccelerations"
            }
        })
    pipelines.integrate =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "integrate"
            }
        })
    
    // render pipeline
    gpu_render_pipeline = device.createRenderPipeline({
        layout: "auto",
        
        // vertex shader for placing the particles
        vertex: {
            module: shader_module,
            entryPoint: "vertex_main"
        },

        fragment: {
            module: shader_module,
            entryPoint: "fragment_main",
            // defines the format of the output
            targets: [{
                format: gpu_canvas_format
            }]
        },

        // this primitive thing just defines how the vertices are going to be assembled into geometry.
        // this means every three vertices will form a triangle.
        primitive: {
            topology: "triangle-list"
        }
    })
}

// bind groups basically connect the pipelines to actual gpu buffers
// so you can use the info from those buffers in your code

// basically a bind group for every function that we want to execute,
// and we lay out what buffers we want to use in those functions.
// quirk that I ran into, you MUST put the buffer here if you want to use it
// in the wgsl function, and you MUST ACTUALLY USE the variable in the function
// for it to not scream at you. so weird dude.
function initialize_bind_groups(){
    return {
        // no for loop here because the variables we are using in each one
        // will be different

        calculateDensity_bind_group: device.createBindGroup({
            layout: pipelines.density.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: gpu_buffers.positions }
                },
                {
                    binding: 4,
                    resource: { buffer: gpu_buffers.densities }
                }
            ]
        }),
        calculatePressures_bind_group: device.createBindGroup({
            layout: pipelines.pressure.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: gpu_buffers.positions }
                },
                {
                    binding: 5,
                    resource: { buffer: gpu_buffers.pressures }
                }
            ]
        }),


        integrate_bind_group: device.createBindGroup({
            layout: pipelines.integrate.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: gpu_buffers.positions }
                },
                {
                    binding: 1,
                    resource: { buffer: gpu_buffers.velocities }
                }
            ]
        }),

        vertex_bind_group : device.createBindGroup({
            layout: gpu_render_pipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 8,
                    resource: { buffer: gpu_buffers.positions }
                }
            ]
        }),

        render_settings_bind_group: device.createBindGroup({
            layout: gpu_render_pipeline.getBindGroupLayout(1),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniform_buffer }
                }
            ]
        }),
    }
}

