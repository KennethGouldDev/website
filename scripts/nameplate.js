
const nameplate_text = document.getElementById("nameplate-text")
const clicks_display = document.getElementById("nameplate-clicks-display")

let clicks = 0

clicks_display.textContent = ""
nameplate_text.addEventListener("click", function(){
    clicks++
    clicks_display.textContent = "clicks: " + clicks
})