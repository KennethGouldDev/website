// this is to open and close the journal entries

// get every journal entry
// query selector basically searches for all of these css classes
const journals = document.querySelectorAll(".journal-entry");
// loop through all the journal entries
journals.forEach(journal =>{
    const header = journal.querySelector(".journal-header");
    const content = journal.querySelector(".journal-content");

    // some trickery happens if we click it too fast,
    // so lets make it not do its stuff if it is animating.
    let is_animating = false

    // listen for if the user clicks the journal entry
    header.addEventListener("click", event => {
        // first of all, the browser will try to do its normal shenanigans when we click the thing
        // but we want to do our own shenanigans. so lets disable that
        event.preventDefault();

        // ignore clicks while the animations are running
        if (is_animating == true){
            return
        }

        is_animating = true

        if (journal.open == false){
            // if its closed, then open it
            journal.open = true;

            // set the height of the content to it's scroll height (the height it wants to be at)
            content.style.height = content.scrollHeight + "px";

            // when the animation ends, set its height to auto instead
            content.addEventListener("transitionend", function handler(){
                content.style.height = "auto";
                content.removeEventListener("transitionend", handler)
                is_animating = false
            })
        } else {
            // so its open, now close it
            
            // set the height to the actual thing
            content.style.height = content.scrollHeight + "px";
            // we cant immediately set it to 0px or else it might act weird,
            // so we wait a frame and then set it to 0.
            requestAnimationFrame(() => {
                content.style.height = "0px"
            })
            
            // when the animation ends, say its now closed
            content.addEventListener("transitionend", function handler(){
                journal.open = false;
                content.removeEventListener("transitionend", handler)
                is_animating = false
            })
        }
    })
})

// lets make them appear one by one
// you can not only get the element, you can get the index of the element as shown here
const initialDelay = 1800;
let staggerDelay = 500;
let staggerDelayMultiplier = 0.92

journals.forEach((journal, index) => {
    // settimeout very simply executes a function after a set amount of time
    setTimeout(() => {
        journal.style.animation = "journalReveal 1s ease forwards"
        // make it clickable
        journal.classList.add("clickable")
    },
    // delay is in milliseconds
    initialDelay + staggerDelay * (index + 1) * Math.pow(staggerDelayMultiplier, index)
    )
    // make the next journal take less time to appear
})