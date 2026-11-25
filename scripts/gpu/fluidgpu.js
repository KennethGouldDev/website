/** @type {GPUDevice | null} */
let device

// ------------------------------------------ CANVAS
/** @type {HTMLCanvasElement} */
const background_canvas = document.getElementById("background");
// get the webgpu canvas context (its like the webgpu equivalent of ctx)
/** @type {GPUCanvasContext} */
const webgpu_context = background_canvas.getContext("webgpu")

// ------------------------------------------------- MOVING RECTANGLES

// track mouse
let mouse = { x: 0, y: 0 }
let clicking = false

// settings
const handle_size = 8
const minimum_rectangle_size = 20
let current_target = null;
let dragging = true;
let last_mouse_down_pos
let last_target_starting_rect
let dragging_side

let resizing_left = false
let resizing_top = false
let resizing_right = false
let resizing_bottom = false

function get_rectangle_target(x, y){
    // loop through all the rectangles
    // loop backwards so that the rectangle on top wins
    for (let i = rectangles.length - 1; i >= 0; i--){
        const r = rectangles[i]
        // outside of the rectangle? skip
        // here we are including the handle margins so that
        // we can still select the rectangle to resize it
        if (x < r.x - handle_size || x > r.x + r.width + handle_size ||
            y < r.y - handle_size || y > r.y + r.height + handle_size) { continue }
        return r
    }
    return null
}

function rectangle_apply_bounds(rectangle){
    // make sure rectangle is within bounds
    if (rectangle.x < 0) { rectangle.x = 0}
    if (rectangle.y < 0) { rectangle.y = 0}
    if (rectangle.x + rectangle.width > background_canvas.width) 
        { rectangle.x = background_canvas.width - rectangle.width}
    if (rectangle.y + rectangle.height > background_canvas.height) 
        { rectangle.y = background_canvas.height - rectangle.height}
    // make sure min width and height are correct
    rectangle.width = Math.max(rectangle.width, minimum_rectangle_size)
    rectangle.height = Math.max(rectangle.height, minimum_rectangle_size)
}

window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;

    if (current_target == null) { return; }
    if (dragging){
        // drag rectangle around
        current_target.x = last_target_starting_rect.x + (mouse.x - last_mouse_down_pos.x)
        current_target.y = last_target_starting_rect.y + (mouse.y - last_mouse_down_pos.y)
    }
    else {
        let mx = Math.max(0, Math.min(background_canvas.width, mouse.x))
        let my = Math.max(0, Math.min(background_canvas.height, mouse.y))
        // resize borders
        if (resizing_left){
            current_target.x = mx
            // make sure this doesnt make the rectangle actually move the bottom right corner
            current_target.x = Math.min(current_target.x, 
                (last_target_starting_rect.x + last_target_starting_rect.width) 
                - minimum_rectangle_size)
            current_target.width = last_target_starting_rect.width + (last_mouse_down_pos.x - mx)
        }
        if (resizing_top){
            current_target.y = my
            // make sure this doesnt make the rectangle actually move the bottom right corner
            current_target.y = Math.min(current_target.y, 
                (last_target_starting_rect.y + last_target_starting_rect.height) 
                - minimum_rectangle_size)
            current_target.height = last_target_starting_rect.height + (last_mouse_down_pos.y - my)
        }
        if (resizing_right){
            current_target.x = last_target_starting_rect.x
            current_target.width = last_target_starting_rect.width - (last_mouse_down_pos.x - mx)
        }
        if (resizing_bottom){
            current_target.y = last_target_starting_rect.y
            current_target.height = last_target_starting_rect.height - (last_mouse_down_pos.y - my)
        }
    }

    rectangle_apply_bounds(current_target)
})

document.addEventListener("mousedown", () =>{
    last_mouse_down_pos = {x: mouse.x, y: mouse.y}
    // whatever rectangle we clicked, select it
    let target = get_rectangle_target(mouse.x, mouse.y)
    if (target == null) { 
        // didnt click a rectangle
        clicking = true
        return; 
    }
    last_target_starting_rect = {x: target.x, y: target.y, width: target.width, height: target.height}
    current_target = target

    // get if we want to drag this or resize this

    // check and see if we clicked on any of the borders of the rectangle
    resizing_left = mouse.x >= target.x - handle_size && mouse.x <= target.x + handle_size
    resizing_top = mouse.y >= target.y - handle_size && mouse.y <= target.y + handle_size
    resizing_right = mouse.x >= target.x + target.width - handle_size && mouse.x <= target.x + target.width + handle_size
    resizing_bottom = mouse.y >= target.y + target.height - handle_size && mouse.y <= target.y + target.height + handle_size

    // if any of them are true, we are resizing
    if (resizing_left || resizing_top || resizing_right || resizing_bottom){
        dragging = false
    }
    else{
        // otherwise, we are dragging
        dragging = true
    }
})
document.addEventListener("mouseup", () =>{
    current_target = null
    clicking = false
})

// --------------------------------------------- FLUID SIM

// These are constants/parameters that *dont* change per particle.
// These we will instead put into a uniform buffer

let gravity = 1000
let target_density = 0.01
let border_damping = 0.95
let air_damping = 0.994
let physics_max_steps_per_frame = 50;
let physics_delta_time = 1.0/960.0;

let simulation_speed = 1;

let pressure_coefficient = 2000000
let viscosity_coefficient = 3000

let density_influence_radius = 15
let pressure_influence_radius = 8
let viscosity_influence_radius = 10

let particle_radius = 3.5
let particle_mass = 1
let particle_min_distance = 3

let particle_amount = 10000

let mouse_influence_radius = 150
let mouse_strength = 80

let color_mode = 0;
let color_sensitivity = 1;
// 0 = velocity
// 1 = density


let spawn_random_variance = 5
let spawn_position_variance = 3

// these are things that can change per particle.
// We will put these in their own buffers
let positions = [];
let velocities = [];
let densities = [];
let pressures = []
let pressure_accelerations = []
let viscosity_accelerations = []


const max_rectangles = 64
// stride in CS usually refers to offsets in memory
// very basically this is how many values im gonna have for each rectangle
// in the rectangles buffer
const rectangle_stride = 10
let rectangle_count = 0
let rectangles = [
    {x: 300, y: 400, width: 200, height: 100, color: [0.1, 0.3, 0.9], selected: false},
    {x: 200, y: 800, width: 50, height: 150, color: [0.1, 0.3, 0.9], selected: false}
]


// GPU!!!
// ----------------------------------------------- INITIALIZE

// this gets initialized with the gpu
let gpu_canvas_format
await initialize_gpu()

let prev_window_width = -1
let prev_window_height = -1
let resize_scale_x = 1
let resize_scale_y = 1
let canvas_initialized = false;
update_canvas()

// create particle data
create_particle_data()


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

// this get initialized with the pipelines
let gpu_render_pipeline
let gpu_rectangle_pipeline
initialize_pipelines()

let bind_groups = initialize_bind_groups()

// ------------------------------------------------------ READBACK

// copy_gpu_data_to_readback()
// let data = await get_gpu_particle_data()
// // feed it back into the variables
// apply_gpu_particle_data(data)
// console.log(data.particle_amount)

// ------------------------------------------------------ RENDER

let prev_timestamp = 0
let physics_accumulate = 0;

let requesting_readback  = false
requestAnimationFrame(animate)
function animate(timestamp){
    // requestAnimationFrame doesnt give deltatime, instead it gives a timestamp.
    // with this, we can calculate deltatime though.
    // NOTE timestamp is in milliseconds, thats why we divide by 1000 here
    let delta = (timestamp - prev_timestamp) / 1000 * simulation_speed;
    prev_timestamp = timestamp
    let time = timestamp/1000; 

    update_rectangles_buffer(delta)

    // do physics process
    // some trickery to make sure it runs at a fixed timestep
    physics_accumulate += delta
    while (physics_accumulate > physics_delta_time) {
        if (physics_accumulate > physics_delta_time * physics_max_steps_per_frame){
            // dont make it execute more than ten times in one frame
            physics_accumulate = physics_delta_time * physics_max_steps_per_frame
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

    // do rectangles
    if (rectangles.length > 0){
        render_pass.setPipeline(gpu_rectangle_pipeline)
        render_pass.setBindGroup(0, bind_groups.rectangle_bind_group)
        render_pass.setBindGroup(1, bind_groups.rectangle_settings_bind_group)
        // 6 vertices per rectangle, one instance per rectangle
        render_pass.draw(6, Math.min(rectangles.length, max_rectangles))
    }

    // do particles
    render_pass.setPipeline(gpu_render_pipeline)
    render_pass.setBindGroup(2, bind_groups.vertex_bind_group)
    render_pass.setBindGroup(1, bind_groups.render_settings_bind_group)
    // draw three vertices for each particle
    // the arguments are: Vertex count, Instance amount
    // so, draw particle_amount objects with 3 vertices
    render_pass.draw(6, particle_amount)

    render_pass.end()

    device.queue.submit([command_encoder.finish()])
}

// PHYSICS PROCESS

function physics_process(delta, time){
    handle_canvas_changing()
    handle_grid()
    // update settings
    update_uniform_buffer()


    let workgroup_size = 64

    // create an object for recording the GPU commands
    const command_encoder = device.createCommandEncoder()
    // begin the compute pass. This is where we give the commands
    const compute_pass = command_encoder.beginComputePass()

    // instantiate grid
    compute_pass.setPipeline(pipelines.instantiateGrid)
    compute_pass.setBindGroup(0, instantiateGrid_bind_group)
    compute_pass.setBindGroup(1, bind_groups.instantiateGrid_settings_bind_group)
    // we want to clear every grid space, so we are actually gonna ask for
    // grid_cell_amount as many invocations
    compute_pass.dispatchWorkgroups(Math.ceil((grid_length_x * grid_length_y) / workgroup_size))

    // do grid
    compute_pass.setPipeline(pipelines.doGrid)
    compute_pass.setBindGroup(0, doGrid_bind_group)
    compute_pass.setBindGroup(1, bind_groups.doGrid_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    compute_pass.setPipeline(pipelines.doGridStarts)
    compute_pass.setBindGroup(0, doGridStarts_bind_group)
    compute_pass.setBindGroup(1, bind_groups.doGridStarts_settings_bind_group)
    compute_pass.dispatchWorkgroups(1)

    compute_pass.setPipeline(pipelines.gridPlaceParticles)
    compute_pass.setBindGroup(0, gridPlaceParticles_bind_group)
    compute_pass.setBindGroup(1, bind_groups.gridPlaceParticles_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))


    // density
    compute_pass.setPipeline(pipelines.density)
    compute_pass.setBindGroup(0, bind_groups.calculateDensities_bind_group)
    compute_pass.setBindGroup(1, bind_groups.calculateDensities_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    // pressure
    compute_pass.setPipeline(pipelines.pressure)
    compute_pass.setBindGroup(0, bind_groups.calculatePressures_bind_group)
    compute_pass.setBindGroup(1, bind_groups.calculatePressures_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    // pressure accelerations
    compute_pass.setPipeline(pipelines.pressureAccelerations)
    compute_pass.setBindGroup(0, bind_groups.calculatePressureAccelerations_bind_group)
    compute_pass.setBindGroup(1, bind_groups.calculatePressureAccelerations_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    // viscosity accelerations
    compute_pass.setPipeline(pipelines.viscosityAccelerations)
    compute_pass.setBindGroup(0, bind_groups.calculateViscosityAccelerations_bind_group)
    compute_pass.setBindGroup(1, bind_groups.calculateViscosityAccelerations_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    // position corrections
    compute_pass.setPipeline(pipelines.calculatePositionCorrections)
    compute_pass.setBindGroup(0, bind_groups.calculatePositionCorrections_bind_group)
    compute_pass.setBindGroup(1, bind_groups.calculatePositionCorrections_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

    // integrate
    compute_pass.setPipeline(pipelines.integrate)
    compute_pass.setBindGroup(0, bind_groups.integrate_bind_group)
    compute_pass.setBindGroup(1, bind_groups.integrate_settings_bind_group)
    compute_pass.dispatchWorkgroups(Math.ceil(particle_amount / workgroup_size))

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
        pos_x += offset_x * spawn_position_variance
        pos_x += (Math.random() - 0.5) * spawn_random_variance
        let pos_y = background_canvas.height/2
        let offset_y = -root/2
        offset_y += Math.floor(i / root)
        pos_y += offset_y * spawn_position_variance
        pos_y += (Math.random() - 0.5) * spawn_random_variance
        positions.push({x: pos_x, y: pos_y})
        velocities.push({x: 0, y: 0})
        densities.push(0)
        pressures.push(0)
        pressure_accelerations.push({x: 0, y: 0})
        viscosity_accelerations.push({x: 0, y: 0})

        // random velocity
        let rand_vel = 0
        velocities[i].x = randf_range(-rand_vel, rand_vel)
        velocities[i].y = randf_range(-rand_vel, rand_vel)
    }
}

var instantiateGrid_bind_group
var doGrid_bind_group
var doGridStarts_bind_group
var gridPlaceParticles_bind_group
var grid_cell_counts_buffer
var grid_cell_starts_buffer
var grid_cell_indices_buffer
var particle_slots_buffer

var grid_cell_size = 0
var grid_length_x = 0
var grid_length_y = 0
var grid_nested_length = 100 // this is unused but to remove it would mean
// shifting the whole uniform buffer down which ahhhhh whatever
function handle_grid(){
    // we need to do a lot to change the grid information.
    // first of all, only do all this is the grid actually changed.
    let new_grid_cell_size = Math.max(density_influence_radius, pressure_influence_radius, viscosity_influence_radius)
    let new_grid_length_x = Math.ceil(background_canvas.width/new_grid_cell_size)
    let new_grid_length_y = Math.ceil(background_canvas.height/new_grid_cell_size)

    // we only make the particle slots and grid cell indices buffer once
    // because their size never changes, it's dependent on the particle size.
    // make them if they dont exist
    if (!grid_cell_indices_buffer){
        grid_cell_indices_buffer = device.createBuffer({
            size: particle_amount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        })
    }
    if (!particle_slots_buffer){
        particle_slots_buffer = device.createBuffer({
            size: particle_amount * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        })
    }


    if (grid_cell_size != new_grid_cell_size || 
        grid_length_x != new_grid_length_x ||
        grid_length_y != new_grid_length_y)
    {  
        grid_cell_size = new_grid_cell_size
        grid_length_x = new_grid_length_x
        grid_length_y = new_grid_length_y
        
        // the grid changed. lets do our thing

        // we need to change the length of the 
        // gpu buffers grid arrays depending
        // on what the new grid values are
        const cell_count = grid_length_x * grid_length_y

        // we DO need to remake these two buffers because they DO change
        // in size whenever the grid changes.

        // destroy the old buffers
        // NOTE this **MIGHT** become a HUGE problem LMFAOAO
        // (the question mark makes sure it exists before it destroys it)
        grid_cell_counts_buffer?.destroy();
        grid_cell_starts_buffer?.destroy();
        // create the new buffers
        grid_cell_counts_buffer = device.createBuffer({
            size: cell_count * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });
        grid_cell_starts_buffer = device.createBuffer({
            size: cell_count * 4,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        // make the new bind groups
        instantiateGrid_bind_group = device.createBindGroup({
            layout: pipelines.instantiateGrid.getBindGroupLayout(0),
            entries:[
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
            ]
        })
        doGrid_bind_group = device.createBindGroup({
            layout: pipelines.doGrid.getBindGroupLayout(0),
            entries:[
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 10, resource: { buffer: particle_slots_buffer } },
            ]
        })
        doGridStarts_bind_group = device.createBindGroup({
            layout: pipelines.doGridStarts.getBindGroupLayout(0),
            entries:[
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
            ]
        })
        gridPlaceParticles_bind_group = device.createBindGroup({
            layout: pipelines.gridPlaceParticles.getBindGroupLayout(0),
            entries:[
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 7, resource: { buffer: grid_cell_indices_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
                { binding: 10, resource: { buffer: particle_slots_buffer } },
            ]
        })

        // redid the neighbors thing so... we are recreating quite a lot on resize actually
        bind_groups.calculateDensities_bind_group = device.createBindGroup({
            layout: pipelines.density.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 4, resource: { buffer: gpu_buffers.densities } },
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 7, resource: { buffer: grid_cell_indices_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
            ]
        })
        bind_groups.calculatePressureAccelerations_bind_group = device.createBindGroup({
            layout: pipelines.pressureAccelerations.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 2, resource: { buffer: gpu_buffers.pressure_accelerations } },
                { binding: 4, resource: { buffer: gpu_buffers.densities } },
                { binding: 5, resource: { buffer: gpu_buffers.pressures } },
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 7, resource: { buffer: grid_cell_indices_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
            ]
        })
        bind_groups.calculateViscosityAccelerations_bind_group = device.createBindGroup({
            layout: pipelines.viscosityAccelerations.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 1, resource: { buffer: gpu_buffers.velocities } },
                { binding: 3, resource: { buffer: gpu_buffers.viscosity_accelerations } },
                { binding: 4, resource: { buffer: gpu_buffers.densities } },
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 7, resource: { buffer: grid_cell_indices_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
            ]
        })
        bind_groups.calculatePositionCorrections_bind_group = device.createBindGroup({
            layout: pipelines.calculatePositionCorrections.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 6, resource: { buffer: grid_cell_counts_buffer } },
                { binding: 7, resource: { buffer: grid_cell_indices_buffer } },
                { binding: 8, resource: { buffer: grid_cell_starts_buffer } },
                { binding: 11, resource: { buffer: gpu_buffers.position_corrections } },
            ]
        })
    }
}

function handle_canvas_changing(){
    if (window.innerWidth == prev_window_width && 
        window.innerHeight == prev_window_height
    ) { return; }
    prev_window_width = window.innerWidth
    prev_window_height = window.innerHeight
    update_canvas()
}

function update_canvas(){
    // we have to cap out how big the canvas can be
    // usually webgpu canvases can only be a max of 8192 wide and tall
    
    const size = get_canvas_size()
    resize_scale_x = size.x / background_canvas.width
    resize_scale_y = size.y / background_canvas.height
    background_canvas.width = size.x;
    background_canvas.height = size.y;

    if (canvas_initialized == false){
        resize_scale_x = 1
        resize_scale_y = 1
        canvas_initialized = true
        return
    }
    // resize rectangles
    for (const r of rectangles){
        r.x *= resize_scale_x
        r.width *= resize_scale_x
        r.y *= resize_scale_y
        r.height *= resize_scale_y
        // to not run into velocity problems
        if (r.prev_x != undefined){
            r.prev_x *= resize_scale_x
            r.prev_y *= resize_scale_y
        }
        rectangle_apply_bounds(r)
    }
}

function get_canvas_size(){
    let maximum = 8192
    // if the device says something different, use that
    if (device){
        maximum = device.limits.maxTextureDimension2D
    }
    let new_width = Math.min(maximum, window.innerWidth)
    let new_height= Math.min(maximum, window.innerHeight)
    return {x: new_width, y: new_height}
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
    const density_data = new Float32Array(densities)
    const pressure_data = new Float32Array(pressures)

    // create the gpu buffers!
    gpu_buffers = {
        positions: create_storage_buffer(position_data),
        velocities: create_storage_buffer(velocity_data),
        pressure_accelerations: create_storage_buffer(pressure_acceleration_data),
        viscosity_accelerations: create_storage_buffer(viscosity_acceleration_data),
        densities: create_storage_buffer(density_data),
        pressures: create_storage_buffer(pressure_data),
        // * 2 because two floats per particle (vec2)
        // this will automatically make it all zeroes
        position_corrections: create_storage_buffer(new Float32Array(particle_amount * 2)),
        // rectangle_stride as many 32 bit values per rectangle
        rectangles: create_storage_buffer(new Float32Array(max_rectangles * rectangle_stride)),
    }

    // create the readback buffers!
    readback_buffers = {
        positions: create_readback_buffer(gpu_buffers.positions),
        velocities: create_readback_buffer(gpu_buffers.velocities),
        pressure_accelerations: create_readback_buffer(gpu_buffers.pressure_accelerations),
        viscosity_accelerations: create_readback_buffer(gpu_buffers.viscosity_accelerations),
        densities: create_readback_buffer(gpu_buffers.densities),
        pressures: create_readback_buffer(gpu_buffers.pressures),
    }
}


function initialize_uniform_buffer(){
    uniform_buffer = device.createBuffer({
        // its important to determine the write size of
        // our uniform buffer. We use 64 bytes here because
        // we have around 50 bytes worth of variables
    size: 128,
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
    uniform_data = new ArrayBuffer(128)
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

    uniform_floats[12] = particle_radius
    uniform_floats[13] = particle_mass

    uniform_uints[14] = particle_amount

    uniform_floats[15] = mouse.x
    uniform_floats[16] = mouse.y
    if (clicking == true){
        uniform_uints[17] = 1
    }
    else{
        uniform_uints[17] = 0
    }
    uniform_floats[18] = mouse_influence_radius
    uniform_floats[19] = mouse_strength

    // figure out how big the grid is gonna be
    uniform_uints[20] = grid_cell_size
    uniform_uints[21] = grid_length_x
    uniform_uints[22] = grid_length_y
    uniform_uints[23] = grid_nested_length

    uniform_uints[24] = color_mode
    uniform_floats[25] = color_sensitivity

    uniform_floats[26] = particle_min_distance

    uniform_floats[27] = resize_scale_x
    uniform_floats[28] = resize_scale_y

    uniform_uints[29] = rectangle_count

    // write to the uniform buffer
    device.queue.writeBuffer(
        uniform_buffer, 0,
        uniform_data
    )

    // reset this so that the gpu only gets the deltas
    // for one physics step
    resize_scale_x = 1
    resize_scale_y = 1
}

// make an array to put the rectangle data in.
// we make it out here instead of in the function so that a bunch of arrays arent made every frame,
// instead we just update this one
let rectangle_array_buffer = new ArrayBuffer(max_rectangles * rectangle_stride * 4)
const rectangle_floats = new Float32Array(rectangle_array_buffer)
const rectangle_uints = new Uint32Array(rectangle_array_buffer)
function update_rectangles_buffer(delta){
    // update rectangle count
    rectangle_count = Math.min(rectangles.length, max_rectangles)

    // cap out deta so that we dont accidentally divide by a huge amount
    // and get really huge vellocity value
    const dt = Math.max(delta, 1/60)

    // update the data array
    for (let i = 0; i < rectangle_count; i++){
        const r = rectangles[i]

        // figure out velocity
        // if this is the first time we are seeing this rectangle,
        // it hasnt moved so its stuff is undefined
        if (r.prev_x == undefined){
            r.prev_x = r.x
            r.prev_y = r.y
        }
        // velocity is distance over time gang!
        const vx = (r.x - r.prev_x) / dt
        const vy = (r.y - r.prev_y) / dt
        r.prev_x = r.x
        r.prev_y = r.y

        // color
        let color = r.color
        if (color == undefined){
            // do a default if no color specified
            color = [0.1, 0.3, 0.9]
        }

        const o = i * rectangle_stride
        rectangle_floats[o + 0] = r.x
        rectangle_floats[o + 1] = r.y
        rectangle_floats[o + 2] = r.width
        rectangle_floats[o + 3] = r.height
        rectangle_floats[o + 4] = vx
        rectangle_floats[o + 5] = vy
        rectangle_floats[o + 6] = color[0]
        rectangle_floats[o + 7] = color[1]
        rectangle_floats[o + 8] = color[2]
        // r.selected is gonna be a boolean in the javascript world
        // so this quick ternary operator converts the boolean into a 0 or 1
        rectangle_uints[o + 9] = r.selected ? 1 : 0
    }
    // update the buffer
    device.queue.writeBuffer(gpu_buffers.rectangles, 0, rectangle_array_buffer)
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
    pipelines.instantiateGrid =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "instantiateGrid"
            }
        }),
    pipelines.doGrid =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "doGrid"
            }
        }),
    pipelines.doGridStarts =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "doGridStarts"
            }
        }),
    pipelines.gridPlaceParticles =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "gridPlaceParticles"
            }
        }),
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
    pipelines.calculatePositionCorrections =
        device.createComputePipeline({
            layout: "auto",
            compute: {
                module: shader_module,
                entryPoint: "calculatePositionCorrections"
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
    gpu_rectangle_pipeline = device.createRenderPipeline({
        layout: "auto",
        vertex: { 
            module: shader_module,
            entryPoint: "vertex_rectangle"
        },
        fragment: {
            module: shader_module,
            entryPoint: "fragment_rectangle",
            targets: [{ format: gpu_canvas_format }]
        },
        primitive: { topology: "triangle-list"}
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
        // NOTE bind groups for the grid are done in a diff function

        instantiateGrid_settings_bind_group: device.createBindGroup({
            layout: pipelines.instantiateGrid.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        doGrid_settings_bind_group: device.createBindGroup({
            layout: pipelines.doGrid.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        doGridStarts_settings_bind_group: device.createBindGroup({
            layout: pipelines.doGridStarts.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]}),
        gridPlaceParticles_settings_bind_group: device.createBindGroup({
            layout: pipelines.gridPlaceParticles.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]}),
        calculateDensities_settings_bind_group: device.createBindGroup({
            layout: pipelines.density.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        calculatePressures_bind_group: device.createBindGroup({
            layout: pipelines.pressure.getBindGroupLayout(0),
            entries: [
                { binding: 4, resource: { buffer: gpu_buffers.densities } },
                { binding: 5, resource: { buffer: gpu_buffers.pressures } },
            ]
        }),
        calculatePressures_settings_bind_group: device.createBindGroup({
            layout: pipelines.pressure.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        calculatePressureAccelerations_settings_bind_group: device.createBindGroup({
            layout: pipelines.pressureAccelerations.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        calculateViscosityAccelerations_settings_bind_group: device.createBindGroup({
            layout: pipelines.viscosityAccelerations.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        calculatePositionCorrections_settings_bind_group: device.createBindGroup({
            layout: pipelines.calculatePositionCorrections.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),


        integrate_bind_group: device.createBindGroup({
            layout: pipelines.integrate.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 1, resource: { buffer: gpu_buffers.velocities } },
                { binding: 2, resource: { buffer: gpu_buffers.pressure_accelerations } },
                { binding: 3, resource: { buffer: gpu_buffers.viscosity_accelerations } },
                { binding: 11, resource: { buffer: gpu_buffers.position_corrections } },
                { binding: 12, resource: { buffer: gpu_buffers.rectangles } },
            ]
        }),
        integrate_settings_bind_group: device.createBindGroup({
            layout: pipelines.integrate.getBindGroupLayout(1),
            entries: [
                {
                    binding: 0,
                    resource: { buffer: uniform_buffer }
                }
            ]
        }),

        vertex_bind_group : device.createBindGroup({
            layout: gpu_render_pipeline.getBindGroupLayout(2),
            entries: [
                { binding: 0, resource: { buffer: gpu_buffers.positions } },
                { binding: 1, resource: { buffer: gpu_buffers.velocities } },
                { binding: 4, resource: { buffer: gpu_buffers.densities } },
            ]
        }),
        render_settings_bind_group: device.createBindGroup({
            layout: gpu_render_pipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } },
            ]
        }),
        rectangle_bind_group: device.createBindGroup({
            layout: gpu_rectangle_pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 12, resource: { buffer: gpu_buffers.rectangles } }
            ]
        }),
        rectangle_settings_bind_group: device.createBindGroup({
            layout: gpu_rectangle_pipeline.getBindGroupLayout(1),
            entries: [
                { binding: 0, resource: { buffer: uniform_buffer } }
            ]
        })
    }
}

