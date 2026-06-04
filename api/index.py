import os, sys
sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from backend.main import app
from mangum import Mangum

handler = Mangum(app)
