import asyncio
from app.main import get_session
from app.s3_service import upload_file_to_s3
session_id = "3496e832-7b58-4141-a1d6-b338d7fb971d"
session = get_session(session_id)
# mock a file path
local_path = session.asset_path("test.txt")
print("local_path:", local_path)
s3_url = upload_file_to_s3(str(local_path))
print("s3_url:", s3_url)
