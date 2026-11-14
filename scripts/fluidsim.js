/** @type {HTMLCanvasElement} */
const background_canvas = document.getElementById("background");
// this gets the canvas' drawing api. think of this variable, `ctx`, as your drawing tool
const ctx = background_canvas.getContext("2d");

// make the canvas match the window size
background_canvas.width = window.innerWidth;
background_canvas.height = window.innerHeight;

// make it so the background canvas resizes whenever the window gets resized
window.addEventListener("resize", () =>{
    let width_delta = window.innerWidth - background_canvas.width
    let height_delta = window.innerHeight - background_canvas.height
    background_canvas.width = window.innerWidth;
    background_canvas.height = window.innerHeight;

    // adjust particle positions
    positions.forEach(position => {
        position.x += width_delta * (position.x/background_canvas.width)
        position.y += height_delta * (position.x/background_canvas.width)
    });
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


// fluid sim!
let particle_amount = 10;

let gravity = 1000;
let border_damping = 0.95;
let air_damping = 0.995;

let positions = [];
let velocities = [];
let densities = [];
let masses = [];
let radiuses = [];
let colors = [];
let stroke_colors = [];


// create particles
for (let i = 0; i < particle_amount; i++){
    positions.push({x: background_canvas.width/2, y: background_canvas.height/3})
    velocities.push({x: 0, y: 0})
    densities.push(0)
    masses.push(0)
    radiuses.push(30)
    colors.push({r: 50, g: 50, b: 200, a: 1})
    stroke_colors.push({r: 10, g: 10, b: 200, a: 0.8})

    // random velocity
    velocities[i].x = randf_range(-500, 500)
    velocities[i].y = randf_range(-2000, 500)
}


// animation and physics functions
let prev_timestamp = 0
let physics_accumulate = 0;
const physics_delta = 1.0/60.0;

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
    while (physics_accumulate > physics_delta) {
        if (physics_accumulate > physics_delta * 10){
            // dont make it execute more than ten times in one frame
            physics_accumulate = 0
            break
        }
        physics_accumulate -= physics_delta
        physics_process(physics_delta, time)
    }

    // clear previous frame
    ctx.clearRect(0,0, background_canvas.width, background_canvas.height)

    // draw particles
    for (let i = 0; i < particle_amount; i++) {
        // draw circle
        ctx.beginPath();
        ctx.arc(positions[i].x, positions[i].y, radiuses[i], 
            0, 2 * Math.PI)
        ctx.fillStyle = 
            "rgba(" + colors[i].r + ", " + 
            colors[i].g + ", " + 
            colors[i].b + ", " + 
            colors[i].a + ")";
        ctx.fill()
        ctx.strokeStyle = 
            "rgba(" + stroke_colors[i].r + ", " + 
            stroke_colors[i].g + ", " + 
            stroke_colors[i].b + ", " + 
            stroke_colors[i].a + ")";
        ctx.lineWidth = 4;
        ctx.stroke();
    }

        // grid visualization thing
    ctx.fillStyle = "rgba(200,50,50,0.8)";
    grid_length_x = Math.ceil(background_canvas.width/grid_cell_size)
    grid_length_y = Math.ceil(background_canvas.height/grid_cell_size)
    for (let x = 0; x < grid_length_x; x++) {
        ctx.fillRect(x * grid_cell_size, 0, 2, 10000)
    }
    for (let y = 0; y < grid_length_y; y++) {
        ctx.fillRect(0, y * grid_cell_size, 10000, 2)
    }
    
    // show which grid is taken
    for (let x = 0; x < grid.length; x++) {
        for (let y = 0; y < grid[x].length; y++) {
            if (grid[x][y].length > 0){
                ctx.fillStyle = "rgba(255,0,0,0.4)"
                ctx.fillRect(x * grid_cell_size, y * grid_cell_size, grid_cell_size, grid_cell_size)

                // if there are any neighbors, color purple
                let neighbor_arrays = get_3x3_grid_cells(x, y, false)
                let is_neighbors = false
                for (let i = 0; i < neighbor_arrays.length; i++) {
                    const element = neighbor_arrays[i];
                    // skip self
                    if (element.length > 0){
                        is_neighbors = true
                        break
                    }
                }
                if (is_neighbors){
                    ctx.fillStyle = "rgba(0,200,200,0.5)"
                    ctx.fillRect(x * grid_cell_size, y * grid_cell_size, grid_cell_size, grid_cell_size)
                }
            };
        }
    }

    requestAnimationFrame(animate)
}

let boid_spawn_interval = 0.3
let boid_stopwatch = -1

function physics_process(delta, time){

    // what we are gonna do is divide the whole screen into a grid.
    // we divide it into a grid so that when the particle checks it's neighbors,
    // it only has to look at the particles in adjacent grid cells.
    // this is great for performance because it doesnt have to check every single other particle.
    doGrid()

    // dont worry, it's just particle physics
    for (let i = 0; i < particle_amount; i++) {

        // do mouse force
        if (clicking){
            // see if particle is near mouse
            let to_particle = {x: positions[i].x - mouse.x, y: positions[i].y - mouse.y}
            let magnitude = Math.hypot(to_particle.x, to_particle.y)
            if (magnitude < 500){
                velocities[i].x -= to_particle.x * delta * 10
                velocities[i].y -= to_particle.y * delta * 10
            }
        }

        // gravity
        velocities[i].y += gravity * delta

        // air damping
        velocities[i].x *= air_damping
        velocities[i].y *= air_damping

        // apply velocities
        positions[i].x += velocities[i].x * delta
        positions[i].y += velocities[i].y * delta

        // collide with borders
        // when they collide, dampen their velocity because friction
        // and also reflect their velocity
        // and also push them out of the wall by setting their position

        // bottom
        if (positions[i].y + radiuses[i] > background_canvas.height){
            velocities[i].x *= border_damping
            velocities[i].y *= border_damping
            velocities[i].y *= -1
            positions[i].y = background_canvas.height - radiuses[i]
        }
        // left
        if (positions[i].x - radiuses[i] < 0){
            velocities[i].x *= border_damping
            velocities[i].y *= border_damping
            velocities[i].x *= -1
            positions[i].x = radiuses[i]
        }
        // right
        if (positions[i].x + radiuses[i] > background_canvas.width){
            velocities[i].x *= border_damping
            velocities[i].y *= border_damping
            velocities[i].x *= -1
            positions[i].x = background_canvas.width - radiuses[i]
        }
        // top
        if (positions[i].y - radiuses[i] < 0){
            velocities[i].x *= border_damping
            velocities[i].y *= border_damping
            velocities[i].y *= -1
            positions[i].y = radiuses[i]
        }
    }
}

function randf_range(a, b){
    return (a + Math.random() * (b - a))
}

// the grid is gonna be an arrays of arrays
// gonna be accessed as if it is 2d. example: grid[x][y]
let grid = []
let grid_cell_size = 80
function doGrid(){
    // clear the grid
    grid = []
    // push the proper amount of arrays
    grid_length_x = Math.ceil(background_canvas.width/grid_cell_size)
    grid_length_y = Math.ceil(background_canvas.height/grid_cell_size)
    for (let x = 0; x < grid_length_x; x++) {
        // add x array
        grid.push([])
        for (let y = 0; y < grid_length_y; y++) {
            grid[x].push([])
        }
    }
    // go through all the particles and put them in the right grid
    for (let i = 0; i < positions.length; i++) {
        let grid_x = Math.floor(positions[i].x / grid_cell_size)
        let grid_y = Math.floor(positions[i].y / grid_cell_size)
        grid[grid_x][grid_y].push(i)
    }
}

function get_3x3_grid_cells(x, y, include_self = true){
    let ret = []
    // we do this in reading order

    // check top
    if (y > 0){
        // top left
        // check left
        if (x > 0){
            ret.push(grid[x-1][y-1])
        }
        // top middle
        ret.push(grid[x][y-1])
        // top right
        // check right
        if (x < grid.length - 1){
            ret.push(grid[x+1][y-1])
        }
    }

    // now middle

    // middle left
    // check left
    if (x > 0){
        ret.push(grid[x-1][y])
    }
    // top middle
    if (include_self){
        ret.push(grid[x][y])
    }
    // middle right
    // check right
    if (x < grid.length - 1){
        ret.push(grid[x+1][y])
    }

    // now bottom
    // check bottom
    if (y < grid[x].length - 1){
        // bottom left left
        // check left
        if (x > 0){
            ret.push(grid[x-1][y+1])
        }
        // bottom middle
        ret.push(grid[x][y+1])
        // bottom right
        // check right
        if (x < grid.length - 1){
            ret.push(grid[x+1][y+1])
        }
    }
    return ret
}