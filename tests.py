import importlib
import inspect
import os
import sys

from chromedriver_py import binary_path
from selenium import webdriver

class UITests:
  def __init__(self):
    options = webdriver.chrome.options.Options()
    options.add_argument('headless=new')
    # os.environ['LD_LIBRARY_PATH'] = '/opt/google/chrome/lib/:' + os.environ.get('LD_LIBRARY_PATH', '')
    service = webdriver.chrome.service.Service(executable_path=binary_path)
    self.driver = webdriver.Chrome(options=options, service=service)

  def loadPage(self, *video_ids):
    url = 'https://localhost:3000'
    params = {}
    for i, video_id in enumerate(video_ids):
      if url.contains('?'):
        url += f'&player{i}={video_id}'
      else:
        url += f'?player{i}={video_id}'
    self.driver.get(url)
    
  def run(self, script):
    return self.driver.execute_script(script)

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

  if len(sys.argv) > 1: # Requested specific test(s)
    tests = [test for test in tests if test[0] in sys.argv[1:]]
  for test in tests:
    # Test setup
    # TODO: Maybe not in local dev?
    os.system('killall chrome') # Murder any chrome executables

    # Run test
    print('---', test[0], 'started')
    try:
      test[1]()
    except Exception:
      print('!!!', test[0], 'failed:')
      import traceback
      traceback.print_exc()
      sys.exit(-1)

    print('===', test[0], 'passed')
  print('\nAll tests passed')
