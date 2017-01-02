// JustInTimeBabel by Larry Gadea

window.JustInTimeBabel = () => {}

window.JustInTimeBabel.beginSilencingErrors = () => {
  try { eval("(async function(){})") } catch (e) {
    window.quietUntilBabel = function (e) { e.preventDefault(); e.stopPropagation() };
    window.addEventListener('error', window.quietUntilBabel, false);
  }
}

window.JustInTimeBabel.itsTime = () => {
  // Just-in-time Babel loading for
  try { eval("(async function(){})") } catch (e) {
    window.removeEventListener('error', window.quietUntilBabel)
    document.write("<script src='https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/6.21.0/babel.min.js'><\/script>")
    document.querySelectorAll("script[data-just-in-time-babel]").forEach((el) => {
      document.write(`<script ${el.src ? `src='${el.src}'` : ''} type='text/babel' data-presets='es2016, stage-2'>${el.innerHTML}<\/script>`)
    })
  }
}