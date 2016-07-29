console.logCopy = console.log.bind(console)
console.log = data =>
  console.logCopy(`%c${new Date().toISOString().replace(/[TZ]/g, " ")}%c${data}`, "color: gray", "")
