import importlib
import inspect
import json
import math
import os
import sys
import time
import traceback
from datetime import datetime
from pathlib import Path
from threading import Thread

import chromedriver_py
import requests
from selenium import webdriver
from selenium.common.exceptions import JavascriptException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

import http_server

class UITests:
  def __init__(self):
    client_secret = os.environ.get('TWITCH_TOKEN', None)
    if not client_secret:
      client_secret = Path('client_secret.txt').open('r').read() # Local testing
    self.client_id = 'hc34d86ir24j38431rkwlekw8wgesp' # Confidential client
    r = requests.post('https://id.twitch.tv/oauth2/token', params={
      'grant_type': 'client_credentials',
      'client_id': self.client_id,
      'client_secret': client_secret,
    })
    self.access_token = r.json()['access_token']

    self.screenshot_no = 0
    self.tmp_folder = Path(os.environ.get('RUNNER_TEMP', Path.home() / 'AppData/Local/Temp'))

  def setup(self):
    options = webdriver.chrome.options.Options()
    options.add_argument('headless=new')
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
    service = webdriver.chrome.service.Service(
      executable_path=chromedriver_py.binary_path,
      service_args=['--log-level=ALL'],
    )
    self.driver = webdriver.Chrome(options=options, service=service)

  def teardown(self):
    self.print_event_log()
    self.print_chrome_log()
    self.screenshot()
    self.driver.close()

  def screenshot(self):
    self.screenshot_no += 1
    path = Path(self.tmp_folder / f'{self.screenshot_no:03}.png')
    self.driver.save_screenshot(path)
    print('Saved screenshot', path)
    return path

  def wait_for_log(self, message, timeout_sec=10):
    self.driver.set_script_timeout(timeout_sec)
    return self.driver.execute_async_script('''
      var [search, callback] = arguments
      console_log = console.log
      console.log = (...args) => {
        console_log(args)
        if (args.join(' ').includes(search)) {
          console.log = console_log
          callback(args)
        }
      }''', message)

  def wait_for_state(self, player, state, timeout_sec=30):
    self.driver.set_script_timeout(timeout_sec)
    return self.driver.execute_async_script('''
      var targetState = %s
      var [maxLoops, player, callback] = arguments
      var interval = setInterval(() => {
        var currentState = players.has(player) ? players.get(player).state : null
        if (currentState === targetState) {
          var playbackState = players.get(player)._player.getPlayerState().playback
          if (playbackState === 'Buffering') {
            console.warn('State reached but player still buffering')
          } else {
            clearInterval(interval)
            console.log(player, 'has reached', targetState, 'within', arguments[0], 'loops. PlaybackState was', playbackState)
            callback()
          }
        }
        if (--maxLoops == 0) {
          console.error(player, 'did not enter state', targetState, 'within', arguments[0], 'loops. Final state was', currentState)
          clearInterval(interval)
        }
      }, 10)
      ''' % state, timeout_sec * 100, player)

  def print_event_log(self):
    event_log = self.driver.execute_script('return window.eventLog')
    print('\n'.join(event_log))
      
  def print_chrome_log(self):
    for log in self.driver.get_log('browser'):
      timestamp = datetime.fromtimestamp(log['timestamp'] / 1000).isoformat()
      message = log['message'].encode('utf-8', errors='backslashreplace')
      print(f'{timestamp}\t{message}')

  def run(self, script):
    return self.driver.execute_script(script)

  def assert_videos_synced_to(self, expected_timestamp):
    # We need the videos to be playing to call getCurrentTimestamp (thanks, twitch).
    # As a result, we give the videos a little time to buffer before calling play()
    time.sleep(5)
    self.run('players.get("player0").play()')
    for player in ['player0', 'player1', 'player2', 'player3']:
      if not self.run(f'return players.has("{player}")'): # Check that this player exists
        continue
      self.wait_for_state(player, 'PLAYING')
      timestamp = self.run(f'return players.get("{player}").getCurrentTimestamp()')
      if abs(timestamp - expected_timestamp) > 1000:
        raise AssertionError(f'{player} was not within 1 second of expectation: {timestamp}, {expected_timestamp}, {timestamp - expected_timestamp}')

  #############
  #!# Tests #!#
  #############
  
  VIDEO_0_START_TIME = 1745837098000 # Start time for 2444833212 (first test video)
  VIDEO_1_START_TIME = 1745837218000 # Start time for 2444833835 (second test video)
  ASYNC_ALIGN = 1500000000000

  def testLoadWithOffsetsAndSyncStart(self):
    player0offset = 245837252000
    player1offset = player0offset + 60000
    url = f'http://localhost:3000?player0=2444833212&offsetplayer0={player0offset}&player1=2444833835&offsetplayer1={player1offset}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')

    # player1 is 1 minute later than player2, so we should align to that
    self.assert_videos_synced_to(self.ASYNC_ALIGN + player1offset)

  def testSeek(self):
    url = f'http://localhost:3000?player0=2444833212&player1=2444833835#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')

    # player1 is 2 minutes later than player2, so we should align to that
    self.assert_videos_synced_to(self.VIDEO_1_START_TIME)
    self.screenshot()
    
    self.run('players.get("player1")._player.pause()')
    for player in ['player0', 'player1']:
      self.wait_for_state(player, 'PAUSED')

    # Simulate a user's seek by using the internal player.
    self.run('players.get("player1")._player.seek(20.0)')
    self.wait_for_state('player0', 'PAUSED')
    self.wait_for_state('player1', 'PAUSED')

    # player1 is 2 minutes later than player2, so we should align to that + the seek time
    self.assert_videos_synced_to(self.VIDEO_1_START_TIME + 20000)

  def testSeekWhileSeeking(self):
    # Load 9 copies of the same video (we don't actually care about the video for this one)
    players = [f'player{i}' for i in range(10)]
    url = f'http://localhost:3000?'
    for player in players:
      url += f'{player}=2444833212&'
    url += f'#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    for player in players:
      self.wait_for_state(player, 'PAUSED')

    # Seek on the first player, then quickly seek again on the last player. Since players seek in order (probably?) the last players' seeking won't be done.
    # Simulate a user's seek by using the internal player.
    self.run('''
      setTimeout(() => players.get("player0")._player.seek(60.0), 0)
      setTimeout(() => players.get("player1")._player.seek(61.0), 1)
      setTimeout(() => players.get("player2")._player.seek(62.0), 2)
      setTimeout(() => players.get("player3")._player.seek(63.0), 3)
      setTimeout(() => players.get("player4")._player.seek(64.0), 4)
      setTimeout(() => players.get("player5")._player.seek(65.0), 5)
      setTimeout(() => players.get("player6")._player.seek(66.0), 6)
      setTimeout(() => players.get("player7")._player.seek(67.0), 7)
      setTimeout(() => players.get("player8")._player.seek(68.0), 8)
      setTimeout(() => players.get("player9")._player.seek(69.0), 9)
    ''')

    # For a while, this caused a nasty thrashing bug, where the two seek values would keep getting hot-potatoed around between players.
    # We can verify that's not happening by waiting for all players to pause.
    for player in players:
      self.wait_for_state(player, 'PAUSED')

    # And I guess technically we can expect this to reach a consistent sync time?
    # Idk where the hell this value is coming from, or why we trust it.
    self.assert_videos_synced_to(self.VIDEO_0_START_TIME + 120000)

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
    
    j = requests.get(f'https://racetime.gg/{race_id}/data').json()
    expected_channel_names = [e['user']['twitch_display_name'] for e in j['entrants']]
    expected_timestamp = datetime.fromisoformat(j['started_at']).timestamp() * 1000

    url = f'http://localhost:3000?race=https://racetime.gg/{race_id}#scope=&access_token=invalid'
    self.driver.get(url)
    
    # The app will try to load the race, but the token is invalid -- so it will show the twitch popup.
    # Wait for the twitch popup to be visible, then click the 'redirect me' button
    redirect = WebDriverWait(self.driver, 5).until(EC.visibility_of_element_located((By.ID, 'twitchRedirectButton')))
    self.screenshot()
    redirect.click()

    # This should now send us to twitch -- which we obviously shouldn't interact with :)
    # Instead, simulate the redirect by sending the driver back to the callback url with our known token.
    assert self.driver.current_url.startswith('https://www.twitch.tv/login')
    url = f'http://localhost:3000#scope=&access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)
    self.wait_for_state('player0', 'PAUSED')

    # Check that we loaded the right stream (per twitch names)
    player0_name = self.run('return players.get("player0").streamer')
    assert player0_name in expected_channel_names

    self.assert_videos_synced_to(expected_timestamp)

if __name__ == '__main__':
  test_class = UITests()
  is_test = lambda method: inspect.ismethod(method) and method.__name__.startswith('test')
  tests = list(inspect.getmembers(test_class, is_test))
  tests.sort(key=lambda func: func[1].__code__.co_firstlineno)
  if len(sys.argv) > 1: # Requested specific test(s)
    tests = [test for test in tests if test[0] in sys.argv[1:]]

  http_server = Thread(target=http_server.main, daemon=True)
  http_server.start()

  for test in tests:
    print('---', test[0], 'started')
    try:
      test_class.setup()
      test[1]()
    except Exception:
      print('!!!', test[0], 'failed:')
      traceback.print_exc()
      sys.exit(-1)
    finally:
      test_class.teardown()

    print('===', test[0], 'passed')
  print('\nAll tests passed')
