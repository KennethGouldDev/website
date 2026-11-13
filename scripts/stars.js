// track mouse
let mouse = {
    x: 0,
    y: 0
}

window.addEventListener("mousemove", (event) => {
    mouse.x = event.clientX;
    mouse.y = event.clientY;
})


// make it so the background canvas resizes whenever the window gets resized
window.addEventListener("resize", () =>{
    let width_delta = window.innerWidth - background_canvas.width
    let height_delta = window.innerHeight - background_canvas.height
    background_canvas.width = window.innerWidth;
    background_canvas.height = window.innerHeight;

    // adjust star position
    stars.forEach(star => {
        let star_speed = star.speed * .1 * star.size
        star.x += width_delta * (star.x/background_canvas.width)
        star.y += height_delta * (star.x/background_canvas.width)
    });
})

// get if the mouse is clicked
let clicking = false

document.addEventListener("mousedown", () =>{
    clicking = true
})
document.addEventListener("mouseup", () =>{
    clicking = false
    // make the stars around cursor explode out
    stars.forEach(star =>{
        let vector = {x: star.x - mouse.x, y: star.y - mouse.y}
        let distance = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
        if (distance < 100){
            star.velocity_x += vector.x * 3
            star.velocity_y += vector.y * 3
        }
    })
})

// make background stars

/** @type {HTMLCanvasElement} */
const background_canvas = document.getElementById("background");
// this gets the canvas' drawing api. think of this variable, `ctx`, as your drawing tool
const ctx = background_canvas.getContext("2d");

// make the canvas match the window size

background_canvas.width = window.innerWidth;
background_canvas.height = window.innerHeight;

// make a list of stars
const stars = [];
const stars_amount = 300;

function lerpf(start, end, t){
    return start + (end - start) * t;
}

let prev_time = 0;
let prev_mouse = {x: 0, y: 0}
// changing this changes the speed of the stars at the beginning
let mouse_force = {x: 0, y: -50}

let since_star_added_time = 0;
const add_star_every_min = 0.02;
const add_star_every_max = 0.1;
// changing this willl delay until stars are added
let add_star_every = 0

const star_min_length = 5;
const star_max_length = 30;

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
    if (physics_accumulate > physics_delta) {
        physics_accumulate -= physics_delta
        physics_process(physics_delta, time)
    }

    // draw stars

    // clear previous frame
    ctx.clearRect(0,0, background_canvas.width, background_canvas.height)

    stars.forEach(star => {
        // set star opacity
        let star_alpha = star.size/10
        if (time < 3){
            star_alpha *= time/3
        }
        star_alpha *= .9

        // fade in
        let time_alive = time - star.time_added
        if (time_alive < 2){
            star_alpha *= time_alive/2
        }

        // make the stars change direction randomly
        star.direction += Math.random()/100

        // if the star is big its usually closer
        // which means it probably looks like its moving faster (parallax)
        let star_speed = star.speed * .1 * star.size

        star.x += star_speed/2 * mouse_force.x * -1
        star.y += star_speed/2 * mouse_force.y * -1

        star.x += Math.cos(star.direction) / 30 * star_speed
        star.y += Math.sin(star.direction) / 15 * star_speed
        star.y += .1 * star_speed

        // wrap the stars around the borders
        if (star.y > background_canvas.height + 10) {
            star.y = -10
        }
        if (star.y < -10){
            star.y = background_canvas.height + 10
        }
        if (star.x > background_canvas.width + 10) {
            star.x = -10
        }
        if (star.x < -10){
            star.x = background_canvas.width + 10
        }

        // draw the star
        star.color += (Math.random() - 0.5) * delta * 200
        ctx.fillStyle = "rgb(150,150," + (200 + star.color) + "," + star_alpha + ")"
        // horizontal
        ctx.fillRect(star.x - star.length/2,
            star.y - star.thickness/2, 
            star.length, 
            star.thickness)
        ctx.fillRect(star.x - star.thickness/2,
            star.y - star.length/2, 
            star.thickness, 
            star.length)
    });


    // Basically, how this runs every frame, is this animate function gets called,
    // and at the end here this function `requestAnimationFrame` waits until
    // the next frame of the website, and then calls this same function again.
    prev_time = timestamp
    prev_mouse.x = mouse.x
    prev_mouse.y = mouse.y
    requestAnimationFrame(animate)
}

function randf_range(a, b){
    return (a + Math.random() * (b - a))
}

function physics_process(delta, time){
    // add stars every x seconds
    if (stars.length < stars_amount){
        since_star_added_time += delta
        if (since_star_added_time > add_star_every){
            since_star_added_time -= add_star_every
            // randomize add star delay
            add_star_every = randf_range(add_star_every_min, add_star_every_max)
            // each star is a dictionary
            stars.push({
                x: Math.random() * background_canvas.width,
                y: Math.random() * background_canvas.height,
                speed: Math.random() + 0.5,
                direction: Math.random() * 3.14159 * 2,
                color: Math.random() * 30 - 15,
                time_added: time,
                velocity_x: 0,
                velocity_y: 0,
                thickness: 0, //set later
                length: randf_range(star_min_length, star_max_length),
                size: 0 //set later
            });
            let change_star = stars.at(-1)
            change_star.thickness = -(change_star.length - star_max_length)/4
            change_star.size = star_max_length - change_star.length
        }
    }

    // calculate mouse delta
    let mouse_delta = {x: mouse.x - prev_mouse.x, 
        y: mouse.y - prev_mouse.y}
    
    // clamp mouse delta
    let mouse_delta_clamp = 100
    mouse_delta.x = Math.min(mouse_delta.x, mouse_delta_clamp)
    mouse_delta.x = Math.max(mouse_delta.x, -mouse_delta_clamp)
    mouse_delta.y = Math.min(mouse_delta.y, mouse_delta_clamp)
    mouse_delta.y = Math.max(mouse_delta.y, -mouse_delta_clamp)

    let mouse_force_inverse_drag = 0.02
    
    let a = mouse_delta.x/3
    mouse_force.x += (a * a) * Math.sign(a) / 200
    mouse_force.x = lerpf(mouse_force.x, 0, mouse_force_inverse_drag)

    // same for y
    a = mouse_delta.y/3
    mouse_force.y += (a * a) * Math.sign(a) / 200
    mouse_force.y = lerpf(mouse_force.y, 0, mouse_force_inverse_drag)

    // if clicking, make stars near cursor go toward mouse
    if (clicking){
        stars.forEach(star =>{
            let vector = {x: star.x - mouse.x, y: star.y - mouse.y}
            let distance = Math.sqrt(vector.x * vector.x + vector.y * vector.y)
            if (distance < 100){
                star.velocity_x -= vector.x * .2
                star.velocity_y -= vector.y * .2
            }
        })
    }

    // do star velocity
    stars.forEach(star =>{
        star.x += star.velocity_x * delta * (star.size/10)
        star.y += star.velocity_y * delta * (star.size/10)

        // dampen
        star.velocity_x *= .99
        star.velocity_y *= .99
    })
}