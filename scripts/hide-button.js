const hideButton = document.getElementById("hide-button")
const toHide = document.getElementById("ui")

hideButton.addEventListener("click", () => {
    // make the body hidden
    // the toggle function will add/remove the class depending on if it has it or not
    toHide.classList.toggle("hide-ui")

    updateText()
})
let mouse_is_over = false
hideButton.addEventListener("mouseenter", () =>{
    mouse_is_over = true
    updateText()
})
hideButton.addEventListener("mouseleave", () =>{
    mouse_is_over = false
    updateText()
})

updateText()
function updateText(){
        // change the text of the button
    if (toHide.classList.contains("hide-ui")){
        hideButton.textContent = "show ui"
    }
    else{
        hideButton.textContent = "hide ui"
    }
    if (mouse_is_over == false){
        hideButton.innerText = hideButton.textContent + "\nv"
    }
    else{
        hideButton.innerText = hideButton.textContent + "\n^"
    }
}