(() => {

var rearrangeMode = false
window.toggleRearrangeMode = function() { setRearrangeMode(!rearrangeMode) }
window.exitRearrangeMode = function() { if (rearrangeMode) setRearrangeMode(false) }
window.isRearrangeMode = function() { return rearrangeMode }
function setRearrangeMode(enabled) {
  rearrangeMode = enabled
  var playersDiv = document.getElementById('players')
  if (enabled) {
    // Add a border color matching the (stable) color of each video. Non-video players get a gray border.
    for (var playerDiv of playersDiv.childNodes) {
      var player = players.get(playerDiv.id)
      var color = (player != null) ? player.color : '#ccc'
      addRearrangeOverlay(playerDiv, color)
    }
  } else {
    // .remove() mutates the live HTMLCollection, so just keep popping until it's empty.
    var overlays = playersDiv.getElementsByClassName('rearrange-overlay')
    while (overlays.length > 0) overlays[0].remove()

    syncPlayerParamsToURL()
    reloadTimeline()
  }
}

window.getPlayerDivsInVisualOrder = function() {
  var playerDivs = Array.from(document.getElementById('players').childNodes)
  playerDivs.sort((a, b) => parseInt(a.style.order) - parseInt(b.style.order))
  return playerDivs
}

// Single source of truth for generating the stable URL, which re-organizes query params to match the visual order.
window.syncPlayerParamsToURL = function() {
  var params = new URLSearchParams(window.location.search)

  // Build a final map of intended player data, starting with the existing URL entries.
  var intendedPlayers = new Map()
  for (var [key, value] of Array.from(params.entries())) {
    if (key.startsWith('player') || key.startsWith('offsetplayer')) {
      intendedPlayers.set(key, parseInt(value))
      params.delete(key) // Drop from the query; we'll re-add later
    }
  }

  // Next, pull in the loaded players. Overwrites URL state in case a player just finished loading.
  for (var player of players.values()) {
    intendedPlayers.set(player.id, player.videoId)
    intendedPlayers.set('offset' + player.id, player.offset)
  }

  // Rebuild positional params in visual order from the merged map.
  var i = 0
  for (var playerDiv of getPlayerDivsInVisualOrder()) {
    var videoId = intendedPlayers.get(playerDiv.id)
    if (videoId == null) continue

    params.append('player' + i, videoId)
    // When Twitch auth is disabled, we emit all offsets so the resulting URL stays in non-auth mode.
    // When Twitch auth is enabled, we omit zero offsets (there must be at least one) to avoid flipping to non-auth mode.
    var offset = intendedPlayers.get('offset' + playerDiv.id) || 0
    if (!FEATURES.DO_TWITCH_AUTH || offset !== 0) {
      params.append('offsetplayer' + i, offset)
    }
    i++
  }

  history.pushState(null, null, '?' + params.toString())
}

window.addRearrangeOverlay = function(playerDiv, color) {
  if (playerDiv.getElementsByClassName('rearrange-overlay').length > 0) return // Already has an overlay; nothing to do.

  var overlay = document.createElement('div')
  overlay.className = 'rearrange-overlay'
  overlay.style = 'position: absolute; inset: 0; z-index: 10; cursor: grab; border: 2px solid transparent; display: flex'
  overlay.style.borderColor = color
//  overlay.style.backgroundColor = color
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
