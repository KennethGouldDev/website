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
        position.y += height_delta * (position.y/background_canvas.height)
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
let particle_amount = 1500;

let gravity = 500;
let target_density = 1;
let border_damping = 0.95;
let air_damping = 0.995;

let density_coefficient = 1000;
let pressure_coefficient = 800000000
let viscosity_coefficient = 5000000

let density_influence_radius = 60
let pressure_influence_radius = 50
let viscosity_influence_radius = 60

let grid_cell_size = Math.max(density_influence_radius, pressure_influence_radius, viscosity_influence_radius)

let do_grid_visualization = false

let positions = [];
let velocities = [];
let densities = [];
let pressures = []
let pressure_accelerations = []
let viscosity_accelerations = []
let masses = [];
let radiuses = [];
let colors = [];
let stroke_colors = [];
let neighbor_particles = [];


// create particles
let root = Math.ceil(Math.sqrt(particle_amount))
for (let i = 0; i < particle_amount; i++){
    // spawn them in a grid formation

    let pos_x = background_canvas.width/2
    let offset_x = -root/2
    offset_x += i % root
    pos_x += offset_x * 20
    let pos_y = background_canvas.height/2
    let offset_y = -root/2
    offset_y += Math.floor(i / root)
    pos_y += offset_y * 20
    positions.push({x: pos_x, y: pos_y})
    velocities.push({x: 0, y: 0})
    densities.push(0)
    pressures.push(0)
    pressure_accelerations.push({x: 0, y: 0})
    masses.push(1)
    radiuses.push(10)
    colors.push({r: 50, g: 50, b: 200, a: 1})
    stroke_colors.push({r: 10, g: 10, b: 200, a: 0.8})

    neighbor_particles.push([])

    // random velocity
    let rand_vel = 0
    velocities[i].x = randf_range(-rand_vel, rand_vel)
    velocities[i].y = randf_range(-rand_vel, rand_vel)
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

    if (do_grid_visualization) doGridVisualization();

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

    // dont worry, it's just particle physics.

    // First we calculate all of our values

    // cache neighbor particles
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        neighbor_particles[particle_i] = get_neighbor_particles(particle_i)
    }

    // calculate densities
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        // loop through all neighbors and change density depending on how close they are
        densities[particle_i] = 0
        for (let index = 0; index < neighbor_particles[particle_i].length; index++) {
            const neighbor_i = neighbor_particles[particle_i][index];

            // DONT actually skip self, because we want to account for our own mass.

            let to_neighbor = {x: positions[neighbor_i].x - positions[particle_i].x,
                y: positions[neighbor_i].y - positions[particle_i].y
            }
            let distance = Math.hypot(to_neighbor.x, to_neighbor.y)
            // if not close enough, skip
            if (distance > density_influence_radius) continue;
            // this is where you use a better smoothing kernel
            // right now it is just linear
            densities[particle_i] += masses[neighbor_i] * SPHpoly6Gradient(distance, density_influence_radius) * density_coefficient
        }
    }


    // pressure the scalar and pressure the force/vector are calculated differently here.
    // the pressure the particle is experiencing/exerting is going to be different from
    // where it actually ends up moving because of pressure
        
    // calculate pressure
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        // pressure is easy its literally just its density vs it's target density
        pressures[particle_i] = 
            Math.max(0, 
                pressure_coefficient * (densities[particle_i] - target_density))
        
    }
    
    // calculate pressure accelerations
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        let pressure_acceleration = {x: 0, y: 0}
        for (let index = 0; index < neighbor_particles[particle_i].length; index++) {
            const neighbor_i = neighbor_particles[particle_i][index];

            let to_particle = {x: positions[particle_i].x - positions[neighbor_i].x,
                y: positions[particle_i].y - positions[neighbor_i].y
            }
            let distance = Math.hypot(to_particle.x, to_particle.y)

            // if on the same spot or outside of influence then skip
            if (distance == 0 || distance >= pressure_influence_radius) continue

            // now we get what direction and how powerful this force needs to be through this formula
            let gradient = SPHspikyGradient(to_particle, distance, pressure_influence_radius)
            
            // this line is interesting. Now we average the pressures of the particle and it's neighbor
            // averaging their pressures lets us account for how both particles interact with eachother
            let pressure_term = (pressures[particle_i] + pressures[neighbor_i]) / 
                (2 * densities[particle_i] * densities[neighbor_i]) 
            // and then divide by the neighbor's density.
            // we do this because this helps the force calculation act differently depending on how dense
            // each area is. we divide by specifically the neighbor's density because we want to know
            // how much that neighbor is contributing to this particle's pressure.
            // and also this is how people did it online lolol

            // finally add it up
            pressure_acceleration.x += -masses[neighbor_i] * pressure_term * gradient.x
            pressure_acceleration.y += -masses[neighbor_i] * pressure_term * gradient.y
        }
        pressure_accelerations[particle_i].x = pressure_acceleration.x
        pressure_accelerations[particle_i].y = pressure_acceleration.y
    }

    // calculate viscosity accelerations
    // viscosity is very basically just going to have two particles come at eachother try to
    // average out their velocities. this makes the fluid move more as a group as opposed to each particle
    // kinda flailing around on its own.
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        let viscosity_acceleration = {x: 0, y: 0}

        for (let index = 0; index < neighbor_particles[particle_i].length; index++) {
            const neighbor_i = neighbor_particles[particle_i][index];
            
            let to_neighbor = {
                x: positions[neighbor_i].x - positions[particle_i].x,
                y: positions[neighbor_i].y - positions[particle_i].y
            }

            let distance = Math.hypot(to_neighbor.x, to_neighbor.y)

            if (distance == 0 || distance >= viscosity_influence_radius) continue

            // this is where we get the viscosity scalar
            let laplacian = SPHlaplacian(distance, viscosity_influence_radius)

            let velocity_difference = {
                x: velocities[neighbor_i].x - velocities[particle_i].x,
                y: velocities[neighbor_i].y - velocities[particle_i].y
            }
            
            // "term" is just a term (haha) for an intermediate calculation in a formula.
            // this is just part of the formula we are using.
            // this might look familiar. Volume = Mass / Density
            let viscosity_term = masses[neighbor_i] / densities[neighbor_i] * laplacian

            // we are done just apply it
            viscosity_acceleration.x += viscosity_coefficient * viscosity_term * velocity_difference.x
            viscosity_acceleration.y += viscosity_coefficient * viscosity_term * velocity_difference.y
        }
        // yay
        viscosity_accelerations[particle_i] = viscosity_acceleration
    }


    let damping = Math.pow(air_damping, delta * 60)
    // Now, we actually apply the values that we got
    for (let particle_i = 0; particle_i < particle_amount; particle_i++) {
        // do mouse force
        if (clicking){
            // see if particle is near mouse
            let to_particle = {x: positions[particle_i].x - mouse.x, y: positions[particle_i].y - mouse.y}
            let magnitude = Math.hypot(to_particle.x, to_particle.y)
            if (magnitude < 200){
                velocities[particle_i].x -= to_particle.x * delta * 30
                velocities[particle_i].y -= to_particle.y * delta * 30
            }
        }

        // change color depending on density
        colors[particle_i].r = densities[particle_i] * 40
        colors[particle_i].b = 200 - densities[particle_i] * 40

        stroke_colors[particle_i].r = colors[particle_i].r - 50
        stroke_colors[particle_i].g = colors[particle_i].g - 50
        stroke_colors[particle_i].b = colors[particle_i].b - 50

        // apply pressure acceleration
        velocities[particle_i].x += pressure_accelerations[particle_i].x * delta
        velocities[particle_i].y += pressure_accelerations[particle_i].y * delta

        // apply viscosity acceleration
        velocities[particle_i].x += viscosity_accelerations[particle_i].x * delta
        velocities[particle_i].y += viscosity_accelerations[particle_i].y * delta

        // gravity
        velocities[particle_i].y += gravity * delta

        // air damping
        velocities[particle_i].x *= damping
        velocities[particle_i].y *= damping

        // apply velocities
        positions[particle_i].x += velocities[particle_i].x * delta
        positions[particle_i].y += velocities[particle_i].y * delta

        // collide with borders
        // when they collide, dampen their velocity because friction
        // and also reflect their velocity
        // and also push them out of the wall by setting their position
        // BTW the particles CANNOT go out of the borders no matter what or else the grid will mess up

        // bottom
        if (positions[particle_i].y + radiuses[particle_i] > background_canvas.height){
            velocities[particle_i].x *= border_damping
            velocities[particle_i].y *= border_damping
            velocities[particle_i].y *= -1
            positions[particle_i].y = background_canvas.height - radiuses[particle_i]
        }
        // left
        if (positions[particle_i].x - radiuses[particle_i] < 0){
            velocities[particle_i].x *= border_damping
            velocities[particle_i].y *= border_damping
            velocities[particle_i].x *= -1
            positions[particle_i].x = radiuses[particle_i]
        }
        // right
        if (positions[particle_i].x + radiuses[particle_i] > background_canvas.width){
            velocities[particle_i].x *= border_damping
            velocities[particle_i].y *= border_damping
            velocities[particle_i].x *= -1
            positions[particle_i].x = background_canvas.width - radiuses[particle_i]
        }
        // top
        if (positions[particle_i].y - radiuses[particle_i] < 0){
            velocities[particle_i].x *= border_damping
            velocities[particle_i].y *= border_damping
            velocities[particle_i].y *= -1
            positions[particle_i].y = radiuses[particle_i]
        }
    }


    // calculate what values we are workin with now
    // `...` in javascript takes the array and spreads them out
    // so this will get the biggest number out of all the densities
    console.log(Math.max(...densities))
}

function get_neighbor_particles(particle_i) {
    let grid_cell_position = get_grid_cell_position_from_position(positions[particle_i].x, positions[particle_i].y)
    let neighbor_grid_cells = get_3x3_grid_cells(grid_cell_position.x, grid_cell_position.y)
    return get_particle_indexes_from_cells(neighbor_grid_cells)
}

function randf_range(a, b){
    return (a + Math.random() * (b - a))
}

// the grid is gonna be an arrays of arrays
// gonna be accessed as if it is 2d. example: grid[x][y]
let grid = []
function doGrid(){
    // clear the grid
    grid = []
    // push the proper amount of arrays
    let grid_length_x = Math.ceil(background_canvas.width/grid_cell_size)
    let grid_length_y = Math.ceil(background_canvas.height/grid_cell_size)
    for (let x = 0; x < grid_length_x; x++) {
        // add x array
        grid.push([])
        for (let y = 0; y < grid_length_y; y++) {
            grid[x].push([])
        }
    }
    // go through all the particles and put them in the right grid
    for (let i = 0; i < positions.length; i++) {
        let grid_pos = get_grid_cell_position_from_position(positions[i].x, positions[i].y)
        grid[grid_pos.x][grid_pos.y].push(i)
    }
}

function get_3x3_grid_cells(x, y, include_this_cell = true){
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
    if (include_this_cell){
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

function get_particle_indexes_from_cells(cells){
    let ret = []
    for (let arrayi = 0; arrayi < cells.length; arrayi++) {
        const array = cells[arrayi];

        // no particles in this array? skip it
        if (array.length == 0) continue;

        for (let i = 0; i < array.length; i++) {
            const particle = array[i];
            ret.push(particle)
        }
    }
    return ret
}

function get_grid_cell_position_from_position(x, y){
    let ret = {x: Math.floor(x/grid_cell_size), y: Math.floor(y/grid_cell_size)}
    // clamp
    let grid_length_x = Math.ceil(background_canvas.width/grid_cell_size)
    let grid_length_y = Math.ceil(background_canvas.height/grid_cell_size)
    ret.x = Math.min(Math.max(0, ret.x), grid_length_x - 1)
    ret.y = Math.min(Math.max(0, ret.y), grid_length_y - 1)
    return ret
}

function doGridVisualization(){
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
}

// these kernel functions are ones that i got from papers covering
// SPH (smoothed particle hydrodynamics)
// They are popular kernels used in calculating the density and pressures of each particle
// if some dudes figured it out better before me, maybe im a bit of a fool to try and reinvent the wheel!

// returns a scalar, mostly used for density
function SPHpoly6Gradient(distance, smoothing_radius){
    if (distance > smoothing_radius) return 0
    let difference = smoothing_radius * smoothing_radius - distance * distance
    return (4 / (Math.PI * Math.pow(smoothing_radius, 8))) * Math.pow(difference, 3)
}
// returns a vector, mostly used for pressure force
// the direction does NOT have to be normalized. that is done here already
function SPHspikyGradient(direction, distance, smoothing_radius){
    if (distance == 0 || distance > smoothing_radius) return {x:0, y:0}
    let magnitude = (-30 / (Math.PI * Math.pow(smoothing_radius, 5))) * Math.pow(smoothing_radius - distance, 2) / distance
    return {x: direction.x * magnitude, y: direction.y * magnitude}
}
// returns a scalar that is commonly used for viscosity
function SPHlaplacian(distance, smoothing_radius){
    if (distance >= smoothing_radius) return 0
    return (40 / (Math.PI * Math.pow(smoothing_radius, 5))) * (smoothing_radius - distance)
}