(() => {

// Rearrange mode: toggled with 'r'. While active, an overlay sits on top of each player iframe
// (blocking pointer events into it) and exposes HTML5 drag-and-drop so the user can swap players.
//
// Invariant: the div with id `playerN` always sits at visual slot N. Index.js relies on this
// (it looks up players by `'player' + N` for URL params, removal, timeline rows). To preserve
// the invariant across swaps we can't move iframes in the DOM (reparenting reloads them), so
// we use CSS flex `order` to change visual position, AND rename the divs (with their child
// element ids, Player.id, and players Map keys) so id == visual slot stays true.
//
// External dependencies (globals from index.js): players, pendingSeekSource, TIMELINE_COLORS.

var rearrangeMode = false
window.toggleRearrangeMode = function() { setRearrangeMode(!rearrangeMode) }
window.exitRearrangeMode = function() { if (rearrangeMode) setRearrangeMode(false) }
function setRearrangeMode(enabled) {
  rearrangeMode = enabled
  // Tint each overlay with its player's timeline row color (or neutral grey for empty slots).
  // Done here rather than at overlay creation so the color picks up the current Player state,
  // including any loads that happened since the last toggle.
  for (var div of playerDivsInVisualOrder()) {
    var player = players.get(div.id)
    var color = (player != null) ? TIMELINE_COLORS[player.colorIndex % TIMELINE_COLORS.length] : '#ccc'
    var overlay = div.querySelector(':scope > .rearrange-overlay')
    overlay.style.borderColor = color
    overlay.style.backgroundColor = color
  }
  // Each overlay reads `display: var(--rearrange-overlay-display, none)`. Setting the variable
  // on the #players ancestor cascades to all overlays in a single DOM write.
  document.getElementById('players').style.setProperty('--rearrange-overlay-display', rearrangeMode ? 'flex' : 'none')
}

// Returns every player tile div in visual order (including empty placeholders).
window.playerDivsInVisualOrder = function() {
  var divs = []
  var count = document.getElementById('players').childElementCount
  for (var i = 0; i < count; i++) divs.push(playerDivAt(i))
  return divs
}

// Returns the player div at visual slot N (whether or not it has a loaded Player).
window.playerDivAt = function(slot) {
  return document.getElementById('player' + slot)
}

// Returns the URL param key ('playerN') for the given player div, based on its visual slot.
// Use this whenever writing playerN/offsetplayerN URL params from a div, so callers don't
// need to assume div.id == URL key.
window.playerKeyFor = function(div) {
  return div.id // Under the current invariant, div.id is already 'player' + slot.
}

window.addRearrangeOverlay = function(playerDiv) {
  // Don't double-add. addPlayer always calls us, so this is the de-dup guard.
  if (playerDiv.querySelector(':scope > .rearrange-overlay') != null) return

  // Set up the host tile for overlay positioning and flex visual ordering. These could live
  // in addPlayer's style string, but keeping them here makes index.js oblivious to rearrange.
  playerDiv.style.position = 'relative'
  playerDiv.style.order = playerDiv.parentNode.childElementCount - 1

  var overlay = document.createElement('div')
  overlay.className = 'rearrange-overlay'
  // Border + background color are filled in by toggleRearrangeMode (so they reflect the
  // current Player state). Display is driven by a CSS custom property on #players.
  overlay.style = 'position: absolute; inset: 0; z-index: 10; cursor: grab; border: 2px solid transparent; display: var(--rearrange-overlay-display, none)'
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
    // Reset any drop-target highlight (e.g. dragleave doesn't fire reliably when the user hits Esc).
    for (var o of document.querySelectorAll('.rearrange-overlay')) o.style.borderWidth = '2px'
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
    if (sourceDiv != null) swapPlayers(sourceDiv, playerDiv)
  })

  playerDiv.appendChild(overlay)
}

// Rename a player div and its child elements whose ids start with `oldId-` (e.g. -form, -text, -grid).
function renamePlayerDiv(div, oldId, newId) {
  div.id = newId
  for (var child of div.querySelectorAll('[id^="' + oldId + '-"]')) {
    child.id = newId + child.id.substring(oldId.length)
  }
}

// Swap two players' visual positions AND their identities, so 'playerN is at visual slot N' holds.
// The iframe DOM nodes do NOT move (reparenting reloads them).
function swapPlayers(divA, divB) {
  var idA = divA.id
  var idB = divB.id

  // 1. Swap CSS flex `order` -- this is what flips the visual layout.
  var tmp = divA.style.order
  divA.style.order = divB.style.order
  divB.style.order = tmp

  // 2. Rename the divs and child elements via a placeholder id to avoid collisions.
  renamePlayerDiv(divA, idA, '__tmp_swap__')
  renamePlayerDiv(divB, idB, idA)
  renamePlayerDiv(divA, '__tmp_swap__', idB)

  // 3. Update Player.id and players Map keys to match the new div ids.
  var playerA = players.get(idA)
  var playerB = players.get(idB)
  players.delete(idA)
  players.delete(idB)
  if (playerA != null) { playerA.id = idB; players.set(idB, playerA) }
  if (playerB != null) { playerB.id = idA; players.set(idA, playerB) }

  // 4. If a seek was in-flight from one of these players, follow the rename.
  if (pendingSeekSource === idA) pendingSeekSource = idB
  else if (pendingSeekSource === idB) pendingSeekSource = idA

  // 5. Persist the new layout to the URL by re-emitting playerN/offsetplayerN values
  // in their new positions. We rebuild the param order to avoid fragmentation from
  // repeated delete+set (URLSearchParams.set appends after a delete).
  var oldParams = new URLSearchParams(window.location.search)
  var newParams = new URLSearchParams()
  // Snapshot the values that need to move.
  var swappedVids = new Map(), swappedOffs = new Map()
  if (oldParams.has(idA)) swappedVids.set(idB, oldParams.get(idA))
  if (oldParams.has(idB)) swappedVids.set(idA, oldParams.get(idB))
  if (oldParams.has('offset' + idA)) swappedOffs.set(idB, oldParams.get('offset' + idA))
  if (oldParams.has('offset' + idB)) swappedOffs.set(idA, oldParams.get('offset' + idB))
  // Walk existing params in order, substituting the affected slots in-place.
  var written = new Set()
  for (var [key, value] of oldParams.entries()) {
    if (key === idA || key === idB) {
      if (swappedVids.has(key)) newParams.append(key, swappedVids.get(key))
      written.add(key)
    } else if (key === 'offset' + idA || key === 'offset' + idB) {
      var slot = key.substring('offset'.length)
      if (swappedOffs.has(slot)) newParams.append(key, swappedOffs.get(slot))
      written.add(key)
    } else {
      newParams.append(key, value)
    }
  }
  // Any slot that had a value on one side but not the other wasn't seen in the loop above; append.
  for (var [slot, val] of swappedVids) if (!written.has(slot)) newParams.append(slot, val)
  for (var [slot, val] of swappedOffs) if (!written.has('offset' + slot)) newParams.append('offset' + slot, val)
  history.pushState(null, null, '?' + newParams.toString())

  reloadTimeline() // Row colors are assigned by visual slot.
}

})()
