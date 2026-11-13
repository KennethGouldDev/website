import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/+esm";
// turn the journal entry markdown files into html and put them in
// marked is a simple library that converts markdown into html
// dompurify is just a safety measure to stop bad html or scripts being injected

// get the journal container
const journalContainer = document.querySelector(".journals")

async function loadJournals(){
    
    // what we have to do is get the list of journal entry paths from
    // journal_entries_list.json (make sure you update this file every time
    // you make a new journal entry}
    const response = await fetch("../journal_entries/journal_entries_list.json")
    const files = await response.json();

    // load each markdown file
    // cant do a normal arrow function here because we have to keep it async
    for (const file of files){
        console.log(`Trying to find journal ${file}`)
        const markdownResponse = await fetch(`../journal_entries/${file}`)

        // error log if cant load a journal
        if (!markdownResponse.ok){
            console.error(
                `Failed to load the file ${file}: HTTP ${markdownResponse.status}`
            )
        }

        const markdown = await markdownResponse.text()

        // extract the front matter (the little info at the top of journal entries)
        // and the markdown content
        // take a look at this jumbly mess..
        // itll return a list where the first element is everything,
        // the second is the metadata, and the third is the content.
        // this is all funny regex
        const match = markdown.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);

        // check if theres a problem (no front matter)
        if (!match){
            console.warn(`bruh you forgot the front matter in ${file}`)
            continue;
        }

        const metadata = match[1]
        const content = match[2]

        // get the title and the date
        // this is also funny regex
        const title = metadata.match(/^title:\s*(.+)$/m)?.[1] ?? "no title"
        const date = metadata.match(/^date:\s*(.+)$/m)?.[1] ?? "no date"

        // this is where dompurify and marked comes in,
        // we are gonna actually convert this to html!
        const html = DOMPurify.sanitize(marked.parse(content))

        // make the journal entry
        // basically make the elements with the right type and the right class
        // and then make them say the proper things
        const entry = document.createElement("div")
        entry.className = "journal-entry"

        // make the header
        const summary = document.createElement("button")
        summary.className = "journal-header"
        summary.type = "button"

        const dateElement = document.createElement("span")
        dateElement.className = "journal-date"
        dateElement.textContent = date

        const titleElement = document.createElement("span")
        titleElement.className = "journal-title"
        titleElement.textContent = title

        summary.append(dateElement, titleElement)

        // same with the content of the entry
        const journalContent = document.createElement("div")
        journalContent.className = "journal-content"

        // this is where we actually plug in the converted html
        const innerContent = document.createElement("div")
        innerContent.innerHTML = html;
        // and put it into the journal content
        journalContent.appendChild(innerContent)

        // avengers assemble!!
        entry.append(summary, journalContent)
        journalContainer.appendChild(entry)
        console.log("end")
    }
}

await loadJournals()

// this is to open and close the journal entries

// get every journal entry
// query selector basically searches for all of these css classes
const journals = document.querySelectorAll(".journal-entry");
// loop through all the journal entries
journals.forEach(journal =>{
    const header = journal.querySelector(".journal-header");
    const content = journal.querySelector(".journal-content");

    let is_open = false;
    let is_animating = false

    // listen for if the user clicks the journal entry
    header.addEventListener("click", async () => {

        // ignore clicks while the animations are running
        if (is_animating) return

        is_animating = true

        if (is_open == false){
            // open it

            content.style.height = "0px";
            content.style.display = "block";

            // force the browser to calculate the height
            content.offsetHeight

            // animate it to the full height (wait a frame first)
            requestAnimationFrame(() => {
                content.style.height = content.scrollHeight + "px"
            })

            // wait for the height transition
            const finishOpening = event => {
                if (event.propertyName !== "height") return
                
                content.removeEventListener("transitionend", finishOpening)

                content.style.height = "auto"

                is_open = true
                is_animating = false
            }

            content.addEventListener("transitionend", finishOpening)
        }
        else{
            // close it

            // get the current height
            content.style.height = content.scrollHeight + "px"
            
            // force update
            content.offsetHeight

            // animate it to nothing
            requestAnimationFrame(() => {
                content.style.height = "0px"
            })

            const finishClosing = event => {
                if (event.propertyName !== "height") return;

                content.removeEventListener("transitionend", finishClosing);

                is_open = false
                is_animating = false
            }

            content.addEventListener("transitionend", finishClosing)

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
        journal.style.animation = "journalReveal 2s ease-out forwards"
        // make it clickable
        journal.classList.add("clickable")
    },
    // delay is in milliseconds
    initialDelay + staggerDelay * (index + 1) * Math.pow(staggerDelayMultiplier, index)
    )
    // make the next journal take less time to appear
})