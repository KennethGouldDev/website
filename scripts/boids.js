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

    // adjust boid position
    boids.forEach(boid => {
        boid.x += width_delta * (boid.x/background_canvas.width)
        boid.y += height_delta * (boid.x/background_canvas.width)
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


// boids simulation!!

let boids = []

let boids_amount = 0;
let maximum_boids = 1000;

let alignment_strength = .8;
let avoidance_strength = 3;
let cohesion_strength = .2;

let alignment_distance = 60;
let avoidance_distance = 50;
let cohesion_distance = 80;
let dont_overlap_distance = 40;

// animation and physics functions
let prev_time = 0
let physics_accumulate = 0;
const physics_delta = 1.0/60.0;

requestAnimationFrame(animate)
function animate(timestamp){
    // requestAnimationFrame doesnt give deltatime, instead it gives a timestamp.
    // with this, we can calculate deltatime though.
    // NOTE timestamp is in milliseconds, thats why we divide by 1000 here
    let delta = (timestamp - prev_time) / 1000;
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

    // draw boids
    boids.forEach(boid => {

        // draw the triangle
        ctx.save()

        ctx.translate(boid.x, boid.y)
        ctx.rotate(boid.angle)

        ctx.beginPath()
        // the three vertexes
        // its gonna be a triangle pointing right
        ctx.moveTo(boid.length/2, 0)
        ctx.lineTo(- boid.length/2, boid.thickness/2)
        ctx.lineTo(- boid.length/2, -boid.thickness/2)

        ctx.closePath()
    
        ctx.fillStyle= `rgba(${boid.color_r}, ${boid.color_g}, ${boid.color_b}, .9)`
        ctx.fill()
        ctx.strokeStyle = "rgba(50, 50, 50, 0.5)";
        ctx.lineWidth = 2;
        ctx.stroke()

        ctx.restore()
    });


    // doGridVisualization()


    prev_time = timestamp
    requestAnimationFrame(animate)
}

let boid_spawn_interval = 0.4
let boid_stopwatch = -1

function physics_process(delta, time){

    // change boids amount based on window width
    let calculated_amount = 30 + (window.innerWidth * window.innerHeight) / 2500
    boids_amount = Math.round(Math.min(
        maximum_boids, 
        calculated_amount
    ))
    console.log(boids_amount)
    console.log(boids.length)

    if (boids.length > boids_amount){
        // more boids than there should be
        boids.pop()
    }

    // spawning 
    if (boids.length < boids_amount){
        boid_stopwatch += delta
        while (boid_stopwatch > boid_spawn_interval){
            boid_stopwatch -= boid_spawn_interval
            boid_spawn_interval *= .91
            boid_spawn_interval = Math.max(boid_spawn_interval, 0.02)

            boids.push({
                x: randf_range(0,background_canvas.width),
                y: -10,
                angle: randf_range(0, 3.141592653589 * 2),
                speed: 100,
                length: 20,
                thickness: 15,
                color_r: 40,
                color_g: 40,
                color_b: 40,
            })
        }
    }

    // do grid
    doGrid()

    // boid physics
    boids.forEach(boid =>{

        // loop through all the neighbors!
        // get nearby boids
        let grid_pos = get_grid_cell_position_from_position(boid.x, boid.y)
        let grid_neighbors = get_3x3_grid_cells(grid_pos.x, grid_pos.y)
        let boid_neighbors = get_boids_from_cells(grid_neighbors)

        let average_fellow_position = {x: 0, y: 0}
        let num_neighbors = 0

        boid_neighbors.forEach(fellowBoid =>{
            if (boid != fellowBoid){
                // make sure the fellow boid is in front of us
                // dot product trickery to figure this out
                // get position relative to boid
                let dx = fellowBoid.x - boid.x
                let dy = fellowBoid.y - boid.y
                // first vector is going to be direction to other boid,
                // second vector is going to be facing direction
                let dot = dx * Math.cos(boid.angle) + dy * Math.sin(boid.angle)
                if (dot > -0.3){
                    // make sure the boid is close enough
                    let vector = {x: fellowBoid.x - boid.x, y: fellowBoid.y - boid.y}
                    let distance = Math.sqrt(vector.x * vector.x + vector.y * vector.y)

                    if (distance < avoidance_distance){
                        // avoidance
                        // if too close, turn away
                        // get angle away from the other boid
                        let theta = Math.atan2(-vector.y, -vector.x)
                        // the closer the boid is, the faster we want to turn away
                        let strength = 1 - (distance / avoidance_distance)
                        boid.angle -= angle_difference(theta, boid.angle) 
                            * delta * avoidance_strength * strength 
                    }

                    if (distance < alignment_distance){
                        // alignment
                        // turn to face a similar angle
                        boid.angle += angle_difference(boid.angle, fellowBoid.angle) * delta * alignment_strength
                    }

                    if (distance < cohesion_distance){
                        // cohesion
                        // get the average position of the nearby boids, and 
                        // steer toward that average
                        num_neighbors += 1
                        average_fellow_position.x += fellowBoid.x
                        average_fellow_position.y += fellowBoid.y
                    }

                    if (distance < dont_overlap_distance){
                        // if they are way too close, literally just push them off eachother
                        let strength = ( 1 - distance / dont_overlap_distance )
                        boid.x -= vector.x * delta * strength
                        boid.y -= vector.y * delta * strength
                    }
                }
            }
        })

        if (num_neighbors > 0){
            // now we can get the average position
            average_fellow_position.x /= num_neighbors
            average_fellow_position.y /= num_neighbors
            // steer toward that
            let dx = average_fellow_position.x - boid.x
            let dy = average_fellow_position.y - boid.y

            let target_angle = Math.atan2(dy, dx)

            boid.angle += angle_difference( boid.angle, target_angle
            )    * delta * cohesion_strength
        }
        else{
            // Zero neighbors? that must mean youre the leader of the pack
            // im the alpha im the leader im the one to trust
            // together we do, whatever it takes, were in this pack for life!
            // AWOOOOOO
            // add in some randomness
            boid.angle += randf_range(-1,1) * delta * Math.random() * 10
        }

        // color
        let target_r = 20 + num_neighbors * 15
        let target_b = 70 - num_neighbors * 5
        // here we are making the colors smoothly change
        boid.color_r = boid.color_r + (target_r - boid.color_r) * delta * 2
        boid.color_b = boid.color_b + (target_b - boid.color_b) * delta * 2
        // slower the more boids following
        boid.speed = 110 + num_neighbors * -1


        // make them steer away from the mouse

        let to_mouse = {x: mouse.x - boid.x, y: mouse.y - boid.y}
        if (Math.hypot(to_mouse.x, to_mouse.y) < 150){
            // steer away from mouse
            let theta = Math.atan2(-to_mouse.y, -to_mouse.x)
            boid.angle -= angle_difference(theta, boid.angle) * delta * 2
        }


        // make sure the boid angle is between -PI and PI
        // this cool code will make it clamped between those two
        boid.angle = Math.atan2(
            Math.sin(boid.angle),
            Math.cos(boid.angle)
        )


        // make them move
        boid.x += Math.cos(boid.angle) * boid.speed * delta
        boid.y += Math.sin(boid.angle) * boid.speed * delta
        
        
        // wrap the boids around the borders
        if (boid.y > background_canvas.height + boid.length) {
            boid.y = -boid.length
        }
        if (boid.y < -boid.length){
            boid.y = background_canvas.height + boid.length
        }
        if (boid.x > background_canvas.width + boid.length) {
            boid.x = -boid.length
        }
        if (boid.x < -boid.length){
            boid.x = background_canvas.width + boid.length
        }
    })
}


function randf_range(a, b){
    return (a + Math.random() * (b - a))
}

function angle_difference(a, b){
    // this function will get the actual angle difference and it 
    // will wrap between -PI and PI
    return Math.atan2(
        Math.sin(b - a),
        Math.cos(b - a)
    )
}


// the grid is gonna be an arrays of arrays
// gonna be accessed as if it is 2d. example: grid[x][y]
let grid = []
let grid_cell_size = cohesion_distance/2
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

    // go through all the boids and put them in the right grid
    for (let i = 0; i < boids.length; i++) {
        // clamp it after
        let boid = boids[i]
        let grid_pos = get_grid_cell_position_from_position(boid.x, boid.y)
        grid[grid_pos.x][grid_pos.y].push(boids[i])
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

function get_boids_from_cells(cells){
    let ret = []
    for (let arrayi = 0; arrayi < cells.length; arrayi++) {
        const array = cells[arrayi];

        // no boids in this array? skip it
        if (array.length == 0) continue;

        for (let i = 0; i < array.length; i++) {
            const boid = array[i];
            ret.push(boid)
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