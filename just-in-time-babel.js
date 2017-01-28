// JustInTimeBabel by Larry Gadea

window.JustInTimeBabel = () => {}

window.JustInTimeBabel.loadedBabel = false
window.addEventListener('error', (e) => {
  let reloadScript = false
  if (e.error.name === "SyntaxError") {
    const errors = [
      "Expected ')' to end a compound expression",
      "Expected ';' after variable declaration",
      "Unexpected keyword"
    ]
    if (errors.some((str) => { return e.error.message.indexOf(str) >= 0 }))
      reloadScript = true
  }

  if (reloadScript) {
    if (!window.JustInTimeBabel.loadedBabel) {
      console.log("Babel is needed. Loading it.")
      window.JustInTimeBabel.loadedBabel = true
      document.write("<script src='https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/6.21.0/babel.min.js'><\/script>")
    }

    if (window.location.href === e.filename) {
      console.log(`Babel is needed in script tag at line ${e.lineno}. Reloading it.`)
      let html = document.documentElement.innerHTML
      let charNo = html.split("\n", e.lineno).join("\n").length
      let scriptStart = html.lastIndexOf("<script", charNo)
      let scriptContents = html.substr(scriptStart).match(/.*>([\s\S]*?)<\/script/m)[1]
      document.write(`<script type='text/babel' data-presets='es2016, stage-2'>${scriptContents}<\/script>`)

    } else {
      console.log(`Babel is needed in ${e.filename}. Reloading it.`)
      document.write(`<script src='${e.filename}' type='text/babel' data-presets='es2016, stage-2'><\/script>`)
    }

    e.preventDefault()
    e.stopPropagation()
  }
}, false);