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
    self.driver.close()
    
  def on_failure(self):
    self.print_event_log()
    self.print_chrome_log()
    self.screenshot()

  def load_page(self, *video_ids):
    url = 'http://localhost:3000?authPrefs=neverSave'
    params = {}
    for i, video_id in enumerate(video_ids):
      url += f'&player{i}={video_id}'
    url += f'#access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)

    # Wait for all players to load and reach the 'pause' state
    for i in range(len(video_ids)):
      self.wait_for_state(f'player{i}', 'PAUSED')

    print('Loaded page with videos', *video_ids)

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

  STATE_STRINGS = 'LOADING,READY,SEEKING_PLAY,PLAYING,SEEKING_PAUSE,PAUSED,SEEKING_START,BEFORE_START,RESTARTING,AFTER_END,ASYNC'.split(',')
  def wait_for_state(self, player, state, timeout_sec=10):
    self.driver.set_script_timeout(timeout_sec)
    return self.driver.execute_async_script('''
      var [maxLoops, player, state, callback] = arguments
      var interval = setInterval(() => {
        if (--maxLoops == 0) clearInterval(interval)
        if (players.has(player) && players.get(player).state === state) {
          clearInterval(interval)
          callback()
        }
      }, 10)
      ''', timeout_sec * 100, player, self.STATE_STRINGS.index(state))

  def print_event_log(self):
    event_log = self.driver.execute_script('return window.eventLog')
    if not event_log:
      print('Event log was empty')
    for event in event_log:
      log_event = [datetime.fromtimestamp(event[0] / 1000).isoformat(), event[1], event[2], self.STATE_STRINGS[event[3]]]
      if len(event) > 4:
        log_event.append(event[4])
      print('\t'.join(map(str, log_event)))
      
  def print_chrome_log(self):
    for log in self.driver.get_log('browser'):
      try:
        print(u'%d\t%s\t%s' % (log['timestamp'], log['level'], log['message']))
      except AttributeError as e:
        print(e)
        print(log['message'].encode('utf-8'))
      except UnicodeEncodeError as e:
        print(e)
        print(log['message'])

  def run(self, script):
    return self.driver.execute_script(script)

  def assert_videos_synced(self):
    timestamps = self.run('''
      var timestamps = []
      for (var player of players.values()) {
        timestamps.push(player.getCurrentTimestamp())
      }
      return timestamps
    ''')
    if max(timestamps) - min(timestamps) < 1000:
      return

    raise AssertionError('Players are not within 1 second of each other:', timestamps)

  #############
  #!# Tests #!#
  #############

  def testLoadAndSyncStart(self):
    self.load_page('2444833212', '2444833835')
    self.run('players.get("player0").play()')
    self.wait_for_state('player0', 'PLAYING')
    self.wait_for_state('player1', 'PLAYING')
    
    self.assert_videos_synced()

  def testSeek(self):
    self.load_page('2444833212', '2444833835')
    # Simulate a user's seek by using the internal player.
    self.run('players.get("player1")._player.seek(20.0)')
    self.wait_for_state('player0', 'PAUSED')
    self.wait_for_state('player1', 'PAUSED')

    # We need the videos to be playing to call getCurrentTimestamp (thanks, twitch).
    # As a result, we give the videos a little time to buffer before calling play()
    time.sleep(5)
    self.run('players.get("player0").play()')
    self.wait_for_state('player0', 'PLAYING')
    self.wait_for_state('player1', 'PLAYING')
    
    self.assert_videos_synced()

  def testRaceInterrupt(self):
    # We need to get a fresh race on each run, so that the VODs haven't expired.
    # Fortunately, OOT randomizer is pretty active. If needed, we could query a few categories.
    j = requests.get('https://racetime.gg/ootr/races/data').json()
    race_id = j['races'][0]['url'][1:] # Starts with a '/' which breaks some of our code >.<
    
    j = requests.get(f'https://racetime.gg/{race_id}/data').json()
    expected_channel_names = [e['user']['twitch_display_name'] for e in j['entrants']]
    expected_timestamp = datetime.fromisoformat(j['started_at']).timestamp() * 1000

    url = f'http://localhost:3000?race=https://racetime.gg/{race_id}#access_token=invalid'
    self.driver.get(url)
    
    # The app will try to load the race, but the token is invalid -- so it will show the twitch popup.
    # Wait for the twitch popup to be visible, then click the 'redirect me' button
    WebDriverWait(self.driver, 5).until(EC.visibility_of_element_located((By.ID, 'twitchRedirectButton'))).click()

    # This should now send us to twitch -- which we obviously shouldn't interact with :)
    # Instead, simulate the redirect by sending the driver back to the callback url with our known token.
    assert self.driver.current_url.startswith('https://www.twitch.tv/login')
    url = f'http://localhost:3000#access_token={self.access_token}&client_id={self.client_id}'
    self.driver.get(url)
    self.wait_for_state('player0', 'PAUSED')

    # Check that we loaded the right stream (per twitch names)
    player0_name = self.run('return players.get("player0").streamer')
    assert player0_name in expected_channel_names

    # Start the first video to see if it's synced up (approximately) with the start of the race
    time.sleep(1) # Wait for video to buffer (or something)
    self.run('players.get("player0").play()')
    self.wait_for_state('player0', 'PLAYING')

    player0_timestamp = self.run('return players.get("player0").getCurrentTimestamp()')
    assert abs(player0_timestamp - expected_timestamp) < 1000

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
      test_class.teardown()
    except Exception:
      print('!!!', test[0], 'failed:')
      traceback.print_exc()
      test_class.on_failure()
      sys.exit(-1)

    print('===', test[0], 'passed')
  print('\nAll tests passed')
