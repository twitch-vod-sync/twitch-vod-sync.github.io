import importlib
import inspect
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path
from threading import Thread

import requests
from selenium import webdriver
from selenium.webdriver import ActionChains
from selenium.common.exceptions import JavascriptException, TimeoutException, WebDriverException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import http_server

class UITests:
  def __init__(self):
    client_secret = os.environ.get('TWITCH_TOKEN', None)
    if not client_secret:
      # Download from https://dev.twitch.tv/console/apps/hc34d86ir24j38431rkwlekw8wgesp
      client_secret = Path('client_secret.txt').open('r').read().strip() # Local testing
    self.client_id = 'hc34d86ir24j38431rkwlekw8wgesp' # Confidential client
    r = requests.post('https://id.twitch.tv/oauth2/token', params={
      'grant_type': 'client_credentials',
      'client_id': self.client_id,
      'client_secret': client_secret,
    })
    if not r.ok:
      print(r.status_code, r.text)
    self.access_token = r.json()['access_token']

    self.screenshot_no = 0
    self.tmp_folder = Path(os.environ.get('RUNNER_TEMP', Path.home() / 'AppData/Local/Temp'))

  def setup(self):
    if 'CI' in os.environ:
      import chromedriver_py
      options = webdriver.chrome.options.Options()
      options.add_argument('headless=new')
      options.add_argument("--window-size=2560,1440")
      service = webdriver.chrome.service.Service(
        executable_path=chromedriver_py.binary_path,
      )
      self.driver = webdriver.Chrome(options=options, service=service)
    else:
      options = webdriver.firefox.options.Options()
      options.add_argument("--width=2560")
      options.add_argument("--height=1440")
      service = webdriver.firefox.service.Service(
        executable_path=Path(__file__).with_name('geckodriver.exe'),
      )
      self.driver = webdriver.Firefox(options=options, service=service)

  def teardown(self):
    self.driver.close()

  def screenshot(self):
    self.screenshot_no += 1
    path = Path(self.tmp_folder / f'{self.screenshot_no:03}.png')
    self.driver.save_screenshot(path)
    print('Saved screenshot', path)
    return path

  def wait_for_last_log(self, message, timeout_sec=10):
    self.driver.set_script_timeout(timeout_sec)
    return self.driver.execute_async_script('''
      var [search, callback] = arguments
      _console_log = console.log
      _timeout = null
      console.log = (...args) => {
        _console_log(...args)
        if (args.join(' ').includes(search)) {
          clearTimeout(_timeout)
          _timeout = setTimeout(() => {
            console.log = _console_log
            callback(args)
          }, 1000)
        }
      }''', message)

  def wait_for_state(self, player, state, timeout_sec=30):
    self.driver.set_script_timeout(timeout_sec + 1)
    return self.driver.execute_async_script('''
      var targetState = "%s"
      var [maxLoops, player, callback] = arguments
      var interval = setInterval(() => {
        var currentState = players.has(player) ? players.get(player).state : null
        if (targetState.includes(String(currentState))) {
          var playbackState = players.get(player)._player.getPlayerState().playback
          if (playbackState === 'Buffering') {
            console.warn('State reached but player still buffering')
          } else {
            clearInterval(interval)
            console.log(player, 'has reached', String(targetState), 'within', arguments[0], 'loops. PlaybackState was', playbackState)
            callback()
          }
        }
        if (--maxLoops == 0) {
          console.error(player, 'did not enter state', String(targetState), 'within', arguments[0], 'loops. Final state was', String(currentState))
          clearInterval(interval)
        }
      }, 10)
      ''' % state, timeout_sec * 100, player)

  print_log = []
  def print(self, *args):
    timestamp = datetime.now(timezone.utc).isoformat()
    message = '\t'.join([timestamp, *map(str, args)])
    self.print_log.append(message)
    print(message)

  def print_event_log(self):
    event_log = self.driver.execute_script('return window.eventLog')
    if event_log is None:
      event_log = []
    event_log += self.print_log
    event_log.sort(key = lambda line: line.split('\t')[0])
    print('\n'.join(event_log))

  def print_chrome_log(self):
    try:
      for log in self.driver.get_log('browser'):
        timestamp = datetime.fromtimestamp(log['timestamp'] / 1000).isoformat()
        message = log['message'].encode('utf-8', errors='backslashreplace')
        print(f'{timestamp}\t{message}')
    except WebDriverException:
      pass # Firefox, probably

  def run(self, script):
    return self.driver.execute_script(script)

  def simulate_seek(self, player, duration):
    time.sleep(1)
    self.print('Seeking', player, 'to', f'{duration:.1f}')
    self.run(f'players.get("{player}")._player.seek({duration:.1f})')
    self.wait_for_last_log('setting pendingSeekTimestamp to 0')

  def simulate_play(self, player):
    self.print('Playing', player)
    player_iframe = self.driver.find_element(By.CSS_SELECTOR, f'div[id="{player}"] > iframe')
    self.driver.switch_to.frame(player_iframe)
    self.driver.find_element(By.CSS_SELECTOR, 'button[data-a-target="player-overlay-play-button"]').click()
    self.driver.switch_to.default_content()
    # Having some trouble with this, twitch is blocking "autoplay" because it thinks the player is hidden.
    # self.run(f'players.get("{player}")._player.play()')

  def simulate_pause(self, player):
    self.print('Pausing', player)
    self.run(f'players.get("{player}")._player.pause()')

  def assert_players_synced_to(self, expected_timestamp):
    players = self.run('return Array.from(players.keys())')
    assert len(players) > 0
    for player in players:
      self.assert_player_position(player, expected_timestamp)
    self.print('All players synced to within 1 second of', datetime.fromtimestamp(expected_timestamp))

  def assert_player_position(self, player, expected_timestamp):
    player_iframe = self.driver.find_element(By.CSS_SELECTOR, f'div[id="{player}"] > iframe')
    self.driver.switch_to.frame(player_iframe)
    duration = self.driver.find_element(By.CSS_SELECTOR, 'p[data-a-target="player-seekbar-current-time"]').text
    self.driver.switch_to.default_content()
    start_time = self.run(f'return players.get("{player}").startTime') / 1000
    timestamp = start_time
    if duration:
      timestamp += int(duration[0:2]) * 3600 # Hours
      timestamp += int(duration[3:5]) *   60 # Minutes
      timestamp += int(duration[6:8]) *    1 # Seconds
    else:
      # Sometimes this text is not visibile (if the video is playing). Hovering seems to be hard so instead I'm doing this.
      duration = self.run(f'return players.get("{player}")._player.getCurrentTime()')
      timestamp += duration
    if abs(timestamp - expected_timestamp) > 1:
      raise AssertionError(f'''
{player} was not within 1 second of expectation.
Expected: {datetime.fromtimestamp(expected_timestamp)}
Actual:   {datetime.fromtimestamp(timestamp)}
Delta:    {timestamp - expected_timestamp} seconds
startTime: {datetime.fromtimestamp(start_time)}
Duration: {duration}
''')

  #############
  #!# Tests #!#
  #############

  VIDEO_0 = '2444833212'
  VIDEO_1 = '2444833835'
  VIDEO_2 = '2693277776'
  VIDEO_3 = '2693278320'
  VIDEO_4 = '2693281245'
  VIDEO_0_START_TIME = 1745837098
  VIDEO_1_START_TIME = 1745837218
  VIDEO_2_START_TIME = 1770652140
  VIDEO_3_START_TIME = 1770652200
  VIDEO_4_START_TIME = 1770652500
  ASYNC_ALIGN = 1500000000_000


  # If we manually specify the offsets, they should be retained after loading.
  def testLoadWithOffsetsAndSyncStart(self):
    player0offset = 30_000
    player1offset = 60_000
    url = f'http://localhost:3000?player0={self.VIDEO_0}&offsetplayer0={player0offset}&player1={self.VIDEO_1}&offsetplayer1={player1offset}'
    self.driver.get(url)
    time.sleep(10)

    # Wait for all players to load and reach the 'pause' state
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')

    # player1 is later than player0, so we should align to that
    self.assert_players_synced_to((self.ASYNC_ALIGN + player1offset) / 1000)

  def testSeek(self):
    url = f'http://localhost:3000?player0={self.VIDEO_0}&player1={self.VIDEO_1}#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    # player1 is 2 minutes later than player2, so we should align to that
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')
    self.assert_players_synced_to(self.VIDEO_1_START_TIME)

    # Test seeking while players are paused (they should stay paused)
    # player1 is 2 minutes later than player2, so we should align to that + the seek time
    self.simulate_seek('player1', 20.0)
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')
    self.assert_players_synced_to(self.VIDEO_1_START_TIME + 20)

    # Resume the players, then test seeking while playing (they should stay playing)
    self.simulate_play('player0')
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PLAYING')

    # Test a seek while playing which is beyond the buffer
    self.simulate_seek('player0', 240.0)

    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PLAYING')
      self.assert_player_position(player, self.VIDEO_0_START_TIME + 240)

  def testSeekWhileSeeking(self):
    players = [f'player{i}' for i in range(9)]
    url = f'http://localhost:3000?'
    for player in players:
      # All players have the same video, since we're just testing seek behavior.
      url += f'{player}={self.VIDEO_0}&'
    url += f'#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    for player in players:
      self.wait_for_state(player, 'PAUSED')

    # Seek on all 10 players in quick succession, to generically stress-test the system.
    time.sleep(1)
    self.print('Seeking all players to 60.0')
    self.run('''
      setTimeout(() => players.get("player0")._player.seek(60.0), 1000)
      setTimeout(() => players.get("player1")._player.seek(60.1), 1001)
      setTimeout(() => players.get("player2")._player.seek(60.2), 1002)
      setTimeout(() => players.get("player3")._player.seek(60.3), 1003)
      setTimeout(() => players.get("player4")._player.seek(60.4), 1004)
      setTimeout(() => players.get("player5")._player.seek(60.5), 1005)
      setTimeout(() => players.get("player6")._player.seek(60.6), 1006)
      setTimeout(() => players.get("player7")._player.seek(60.7), 1007)
      setTimeout(() => players.get("player8")._player.seek(60.8), 1008)
    ''')
    self.wait_for_last_log('setting pendingSeekTimestamp to 0')

    # For a while, this caused a nasty thrashing bug, where the various seeks would keep getting hot-potatoed around between players.
    # We can verify that's not happening by waiting for all players to pause.
    for player in players:
      self.wait_for_state(player, 'PAUSED')

    # The 'assert sync' function has a 1s grace period, so this timing should be ok.
    self.assert_players_synced_to(self.VIDEO_0_START_TIME + 61)

    # Do it again, this time with the players all live
    self.simulate_play('player0')
    for player in players:
      self.wait_for_state(player, 'PLAYING')

    time.sleep(1)
    self.print('Seeking all players to 120.0')
    self.run('''
      setTimeout(() => players.get("player0")._player.seek(120.0), 1000)
      setTimeout(() => players.get("player1")._player.seek(120.1), 1001)
      setTimeout(() => players.get("player2")._player.seek(120.2), 1002)
      setTimeout(() => players.get("player3")._player.seek(120.3), 1003)
      setTimeout(() => players.get("player4")._player.seek(120.4), 1004)
      // setTimeout(() => players.get("player5")._player.seek(120.5), 1005)
      // setTimeout(() => players.get("player6")._player.seek(120.6), 1006)
      // setTimeout(() => players.get("player7")._player.seek(120.7), 1007)
      // setTimeout(() => players.get("player8")._player.seek(120.8), 1008)
    ''')
    self.wait_for_last_log('setting pendingSeekTimestamp to 0')

    for player in players:
      self.wait_for_state(player, 'PLAYING')
      self.assert_player_position(player, self.VIDEO_0_START_TIME + 121)


  def testRaceInterrupt(self):
    # We need to get a fresh race on each run, so that the VODs haven't expired.
    # Fortunately, OOT randomizer is pretty active. If needed, we could query a few categories.
    j = requests.get('https://racetime.gg/ootr/races/data').json()
    for race in j['races']:
      if race.get('streaming_required', True): # Streaming is required by default but some races override this
        race_id = race['url'][1:] # Starts with a '/' which breaks some of our code >.<
        break
    else:
      raise ValueError('None of the OOTR races were suitable for a test')

    r = requests.get(f'https://racetime.gg/{race_id}/data')
    r.encoding = 'utf-8'
    j = r.json()
    expected_channel_names = [e['user']['twitch_display_name'] for e in j['entrants']]
    expected_timestamp = datetime.fromisoformat(j['started_at']).timestamp()

    url = f'http://localhost:3000?race=https://racetime.gg/{race_id}#scope=&access_token=invalid'
    self.driver.get(url)

    # The app will try to load the race, but the token is invalid -- so it will show the twitch popup.
    # Wait for the twitch popup to be visible, then click the 'redirect me' button
    self.print('Clicking twitch redirect button')
    redirect = WebDriverWait(self.driver, 5).until(EC.visibility_of_element_located((By.ID, 'twitchRedirectButton')))
    redirect.click()

    # This should now send us to twitch -- which we obviously shouldn't interact with :)
    # Instead, simulate the redirect by sending the driver back to the callback url with our known token.
    assert self.driver.current_url.startswith('https://www.twitch.tv/login')
    url = f'http://localhost:3000#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    time.sleep(5)
    cc_buttons = self.driver.find_elements(By.CSS_SELECTOR, '[data-a-target="content-classification-gate-overlay-start-watching-button"]')
    for button in cc_buttons:
      button.click()

    players = self.run('return Array.from(players.keys())')
    for player in players:
      self.wait_for_state(player, 'PAUSED')
      self.assert_player_position(player, expected_timestamp)

      # Check that we loaded the right stream (per twitch names)
      player_name = self.run(f'return players.get("{player}").channel')
      assert player_name in expected_channel_names

  def testDiscontinuity(self):
    url = f'http://localhost:3000?player0={self.VIDEO_2}#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    self.wait_for_state('player0', 'PAUSED')

    # Override the channel lookup function, since we need to test with highlights (for stability)
    self.run('window.getTwitchChannelVideos = function () { return window.getTwitchVideosDetails(["' + self.VIDEO_3 + '", "' + self.VIDEO_4 + '"]) }')

    self.print('Mock loading channel videos into player1')
    player1_form = self.driver.find_element(By.ID, 'player1-form')
    player1_video_text = player1_form.find_element(By.NAME, 'video')
    player1_video_text.send_keys('test_channel_name')
    player1_form.submit()

    # Since player0 is already loaded, we resync player1 to the existing timestamp (before its start)
    self.wait_for_state('player1', 'BEFORE_START')
    self.assert_player_position('player0', self.VIDEO_2_START_TIME)
    self.assert_player_position('player1', self.VIDEO_3_START_TIME)

    # We should find VIDEO_3, since it's the earliest video which overlaps the timeline. (neither video overlaps the playhead)
    assert self.run('return players.get("player1").videoId') == self.VIDEO_3
    assert self.run('return players.get("player1").nextVideoDetails') == None

    # Seek to the end of VIDEO_3 and confirm that we load the next video.
    self.simulate_seek('player1', 220.0)
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')
    self.assert_players_synced_to(self.VIDEO_3_START_TIME + 220)

    assert self.run('return players.get("player1").videoId') == self.VIDEO_3
    assert self.run('return players.get("player1").nextVideoDetails.id') == self.VIDEO_4

    # There's about 20 seconds left in the second video, so it should end (and refresh) within 30 seconds.
    self.simulate_play('player1')
    time.sleep(30)

    self.wait_for_state('player1', 'BEFORE_START')
    assert self.run('return players.get("player1").videoId') == self.VIDEO_4
    assert self.run('return players.get("player1").nextVideoDetails') == None

if __name__ == '__main__':
  loop_count = 1
  if os.environ.get('GITHUB_EVENT_NAME', None) == 'schedule':
    loop_count = 20 # Require additional consistency for our nightly job vs ad-hoc pushes
  elif len(sys.argv) > 1 and sys.argv[1].isdigit():
    loop_count = int(sys.argv.pop(1))
  elif len(sys.argv) > 2:
    loop_count = int(sys.argv.pop(2))

  test_class = UITests()
  is_test = lambda method: inspect.ismethod(method) and method.__name__.startswith('test')
  tests = list(inspect.getmembers(test_class, is_test))
  tests.sort(key=lambda func: func[1].__code__.co_firstlineno)
  if len(sys.argv) > 1: # Requested specific test(s)
    tests = [test for test in tests if test[0] in sys.argv[1:]]

  http_server = Thread(target=http_server.main, daemon=True)
  http_server.start()

  for test in tests:
    for i in range(loop_count):
      test_class.setup()
      print('---', test[0], 'started, attempt', i + 1)
      try:
        test[1]()
      except Exception:
        test_class.print_event_log()
        test_class.screenshot()
        print('!!!', test[0], 'failed:')
        traceback.print_exc()
        sys.exit(-1)
      finally:
        test_class.teardown()

      print('===', test[0], 'passed')
  print('\nAll tests passed')
