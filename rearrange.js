(() => {

var rearrangeMode = false
window.toggleRearrangeMode = function() { setRearrangeMode(!rearrangeMode) }
window.exitRearrangeMode = function() { if (rearrangeMode) setRearrangeMode(false) }
function setRearrangeMode(enabled) {
  rearrangeMode = enabled
  var playersDiv = document.getElementById('players')
  if (enabled) {
    // Add a border color matching the (stable) color of each video. Non-video players get a gray border.
    for (var playerDiv of playersDiv.childNodes) {
      var player = players.get(playerDiv.id)
      var color = (player != null) ? TIMELINE_COLORS[player.colorIndex % TIMELINE_COLORS.length] : '#ccc'
      addRearrangeOverlay(playerDiv, color)
    }
  } else {
    for (var playerDiv of playersDiv.childNodes) {
      var overlay = playerDiv.querySelector(':scope > .rearrange-overlay')
      if (overlay != null) overlay.remove()
    }

    // TODO: URL order somehow
    reloadTimeline()
  }
}

window.getPlayerDivsInVisualOrder = function() {
  var playerDivs = Array.from(players.values()).map(player => document.getElementById(player.id))
  playerDivs.sort((a, b) => parseInt(a.style.order) - parseInt(b.style.order))
  return playerDivs
}

window.addRearrangeOverlay = function(playerDiv, color) {
  if (playerDiv.querySelector(':scope > .rearrange-overlay') != null) return // TODO: I think there's a less CSS-y way of doing this check.

  var overlay = document.createElement('div')
  overlay.className = 'rearrange-overlay'
  overlay.style = 'position: absolute; inset: 0; z-index: 10; cursor: grab; border: 2px solid transparent; display: flex'
  overlay.style.borderColor = color
  overlay.style.backgroundColor = color
  overlay.draggable = true

  overlay.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', playerDiv.id)
    e.dataTransfer.effectAllowed = 'move'
    overlay.style.cursor = 'grabbing'
    overlay.style.opacity = '0.5'
  })
  overlay.addEventListener('dragend', () => {
    overlay.style.cursor = 'grab'
    overlay.style.opacity = '1'
  })
  overlay.addEventListener('dragover', (e) => {
    e.preventDefault() // Required to allow a drop.
    e.dataTransfer.dropEffect = 'move'
  })
  overlay.addEventListener('dragenter', () => { overlay.style.borderWidth = '5px' })
  overlay.addEventListener('dragleave', () => { overlay.style.borderWidth = '2px' })
  overlay.addEventListener('drop', (e) => {
    e.preventDefault()
    overlay.style.borderWidth = '2px'
    var sourceId = e.dataTransfer.getData('text/plain')
    if (!sourceId || sourceId === playerDiv.id) return
    var sourceDiv = document.getElementById(sourceId)
    if (sourceDiv != null) {
      var tmp = sourceDiv.style.order
      sourceDiv.style.order = playerDiv.style.order
      playerDiv.style.order = tmp
    }
  })

  playerDiv.appendChild(overlay)
}

})()
