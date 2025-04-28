import importlib
import inspect
import os
import sys
import traceback
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
    client_secret = os.environ.get('TWITCH_TOKEN', Path('client_secret.txt').open('r').read())
    r = requests.post('https://id.twitch.tv/oauth2/token', params={
      'grant_type': 'client_credentials',
      'client_id': 'hc34d86ir24j38431rkwlekw8wgesp',
      'client_secret': client_secret,
    })
    self.access_token = r.json()['access_token']

    self.screenshot_no = 0
    self.tmp_folder = Path(os.environ.get('RUNNER_TEMP', Path.home() / 'AppData/Local/Temp'))

    options = webdriver.chrome.options.Options()
    options.add_argument('headless=new')
    options.set_capability('goog:loggingPrefs', {'browser': 'ALL'})
    service = webdriver.chrome.service.Service(
      executable_path=chromedriver_py.binary_path,
      service_args=['--log-level=ALL'],
      log_path=self.tmp_folder / 'chrome_logs.txt',
    )
    self.driver = webdriver.Chrome(options=options, service=service)

  def loadPage(self, *video_ids):
    url = 'http://localhost:3000?authPrefs=neverSave'
    params = {}
    for i, video_id in enumerate(video_ids):
      url += f'&player{i}={video_id}'
    url += f'#access_token={self.access_token}'
    self.driver.get(url)

    # TODO: Maybe there's something more stable here, for now I am detecting players loading via log message.
    self.wait_for_log('was last to load, syncing all videos')
    
    print('Loaded page with videos', *video_ids)

  def screenshot(self):
    self.screenshot_no += 1
    path = Path(self.tmp_folder / f'{self.screenshot_no:03}.png')
    self.driver.save_screenshot(path)
    print('Saved screenshot', path)
    return path
    
  def wait_for_log(self, message, timeout_sec=10):
    self.driver.set_script_timeout(timeout_sec)
    self.driver.execute_async_script('''
      var callback = arguments[0]
      console_log = console.log
      console.log = (...args) => {
        console_log(args)
        if (args.join(' ').includes('%s')) {
          console.log = console_log
          callback()
        }
      }''' % message)

  def run(self, script):
    return self.driver.execute_script(script)

  #############
  #!# Tests #!#
  #############

  def testLoadAndSyncStart(self):
    self.loadPage('2444617320', '2444617321')
    player0 = self.run('return players.get("player0").currentTimestamp')
    player1 = self.run('return players.get("player1").currentTimestamp')
    print(player0)
    self.screenshot()
    assert player0 == player1

if __name__ == '__main__':
  test_class = UITests()
  is_test = lambda method: inspect.ismethod(method) and method.__name__.startswith('test')
  tests = list(inspect.getmembers(test_class, is_test))
  tests.sort(key=lambda func: func[1].__code__.co_firstlineno)

  http_server = Thread(target=http_server.main, daemon=True)
  http_server.start()

  if len(sys.argv) > 1: # Requested specific test(s)
    tests = [test for test in tests if test[0] in sys.argv[1:]]
  for test in tests:
    print('---', test[0], 'started')
    try:
      test[1]()
    except Exception:
      print('!!!', test[0], 'failed:')
      traceback.print_exc()
      test_class.screenshot()
      sys.exit(-1)

    print('===', test[0], 'passed')
  print('\nAll tests passed')
