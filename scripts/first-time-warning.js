const warning = document.getElementById("first-time-warning")
const acknowledge_button = document.getElementById("first-time-warning-acknowledge-button")

// button
acknowledge_button.addEventListener("click", () => {
    localStorage.setItem("first-time-warning-accepted", "true");
    warning.classList.add("hidden");
})

// warning is already hidden,
// wait a couple seconds and then check if the user has seen the warning.
// this is for animation purposes.

// see if the user has already acknowledged the warning
setTimeout(() => {
    if (localStorage.getItem("first-time-warning-accepted") != "true"){
        warning.classList.remove("hidden");
    }
}, 2500)

