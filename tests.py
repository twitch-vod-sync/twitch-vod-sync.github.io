import importlib
import inspect
import os
import subprocess
import sys
import traceback
from pathlib import Path

from chromedriver_py import binary_path
from selenium import webdriver
from selenium.common.exceptions import JavascriptException

class UITests:
  def __init__(self):
    options = webdriver.chrome.options.Options()
    options.add_argument('headless=new')
    service = webdriver.chrome.service.Service(executable_path=binary_path)
    self.driver = webdriver.Chrome(options=options, service=service)
    self.tmp_folder = Path(os.environ.get('RUNNER_TEMP', Path.home() / 'AppData/Local/Temp'))
    self.screenshot_no = 0

  def loadPage(self, *video_ids):
    url = 'http://localhost:3000'
    params = {}
    for i, video_id in enumerate(video_ids):
      url += '?' if i == 0 else '&'
      url += f'player{i}={video_id}'
    self.driver.get(url)
    
  def screenshot(self):
    self.screenshot_no += 1
    path = Path(self.tmp_folder / self.screenshot_no + '.png')
    self.driver.save_screenshot(path)
    return path
    
  def run(self, script):
    try:
      return self.driver.execute_script(script)
    except JavascriptException:
      traceback.print_exc()
      print('Saved screenshot to', self.screenshot())
      return None

  #############
  #!# Tests #!#
  #############

  def testLoadAndSyncStart(self):
    self.loadPage('1234', '5678')
    player0 = self.run('return players.get("player0").currentTimestamp')
    player1 = self.run('return players.get("player1").currentTimestamp')
    assert player0 == player1

if __name__ == '__main__':
  testClass = UITests()
  is_test = lambda method: inspect.ismethod(method) and method.__name__.startswith('test')
  tests = list(inspect.getmembers(testClass, is_test))
  tests.sort(key=lambda func: func[1].__code__.co_firstlineno)

  subprocess.Popen([sys.executable, 'http_server.py'], start_new_session=True)

  if len(sys.argv) > 1: # Requested specific test(s)
    tests = [test for test in tests if test[0] in sys.argv[1:]]
  for test in tests:
    print('---', test[0], 'started')
    try:
      test[1]()
    except Exception:
      print('!!!', test[0], 'failed:')
      traceback.print_exc()
      sys.exit(-1)

    print('===', test[0], 'passed')
  print('\nAll tests passed')
