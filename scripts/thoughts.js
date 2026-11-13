// this is going to convert thoughts.md into the htm for the little thoughts section

import { marked } from "https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js";
import DOMPurify from "https://cdn.jsdelivr.net/npm/dompurify@3.2.6/+esm";

const thoughtContainer = document.querySelector(".thought-container");

async function loadThoughts() {
    // fetch the markdown file
    const response = await fetch("../thoughts.md")

    if (!response.ok){
        throw new Error(`failed to load the thoughts bruh wtf: ${response.status}`)
    }

    const markdown = await response.text()

    // split up the markdown into the individual thoughts
    // some regex and polishing shenanigans
    const entries = markdown
        .split(/^<!-- thought -->\s*$/m)
        .map(entry => entry.trim())
        .filter(entry => entry.length > 0)
    
    // we are gonna do something cool with the year shenanigans
    let currentYear = null;

    for (const entry of entries) {
        // seperate the date from the thought
        const lines = entry.split(/\r?\n/)

        const date = lines[0].trim()
        const content = lines.slice(1).join("\n").trim()

        // get the year, month, and day
        const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)

        if (!match){
            console.warn(`invalid thought date: ${date}`)
            continue
        }

        const year = Number(match[1])
        const month = Number(match[2])
        const day = Number(match[3])

        // create a year heading whenevr the year changes
        if (year !== currentYear){
            currentYear = year;

            // make the element
            const yearElement = document.createElement("div")
            yearElement.className = "thought-year"
            yearElement.textContent = year

            thoughtContainer.appendChild(yearElement)
        }

        //format the date for the date display
        // ooh pretty cool constructor called Date
        // we subtract 1 from month because js months start from 0
        const dateObject = new Date(year, month - 1, day)
        // convert it into month (spelled out), day
        const dateText = getRelativeDate(dateObject);

        // make the elements!
        const thought = document.createElement("div")
        thought.className = "thought"

        const dateElement = document.createElement("span")
        dateElement.className = "thought-date"
        dateElement.textContent = dateText

        // convert the markdown to html
        const html = DOMPurify.sanitize(marked.parse(content))

        thought.appendChild(dateElement)
        thought.insertAdjacentHTML("beforeend", html)

        thoughtContainer.appendChild(thought)
    }
}

loadThoughts().catch(console.error)

function getRelativeDate(dateObject){
    const now = new Date()

    // get todays date
    const today = Date.UTC(
        now.getFullYear(),
        now.getMonth(),
        now.getDate()
    )

    // get the given date
    const givenDay = Date.UTC(
        dateObject.getFullYear(),
        dateObject.getMonth(),
        dateObject.getDate()
    )

    //calculate the number of calendar days between the two dates
    // today - thoughtDay will give the difference between the two dates in milliseconds
    // thats why we divide by milliseconds, minutes, hours, then days
    const daysAgo = Math.round(
        (today - givenDay) / (1000 * 60 * 60 * 24)
    )

    if (daysAgo == 0){
        return "today"
    }
    
    if (daysAgo == 1){
        return "yesterday"
    }

    if (daysAgo <= 7){
        return `${daysAgo} days ago`
    }

    // anything older just gets their regular date
    return dateObject.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric"
    })
}