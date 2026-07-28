import os
import boto3
from botocore.exceptions import NoCredentialsError, ClientError
from botocore.client import Config
from dotenv import load_dotenv
from pathlib import Path
import uuid
import mimetypes

# Tải biến môi trường từ file .env
load_dotenv()

S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY_ID")
S3_SECRET_KEY = os.getenv("S3_SECRET_ACCESS_KEY")
S3_BUCKET = os.getenv("S3_BUCKET", "teky-prod")
S3_ENDPOINT = os.getenv("S3_ENDPOINT", "https://s3-sgn10.fptcloud.com")
S3_REGION = os.getenv("S3_REGION", "sgn10")
S3_PREFIX = os.getenv("S3_UPLOAD_PREFIX", "teky-school")
S3_PUBLIC_BASE = os.getenv("S3_PUBLIC_BASE_URL", "https://s3-sgn10.fptcloud.com/teky-prod")
S3_FORCE_PATH_STYLE = os.getenv("S3_FORCE_PATH_STYLE", "false").lower() == "true"

# Khởi tạo boto3 client
s3_config = {
    'request_checksum_calculation': 'when_required',
    'response_checksum_validation': 'when_required'
}
if S3_FORCE_PATH_STYLE:
    s3_config['s3'] = {'addressing_style': 'path'}

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=Config(**s3_config)
)

def upload_file_to_s3(file_path: str, content_type: str = None) -> str:
    """
    Upload một file cục bộ lên FPT Cloud S3 và trả về Public URL.
    Sẽ tạo một tên file ngẫu nhiên để tránh trùng lặp.
    """
    if not os.path.exists(file_path):
        print(f"[S3] File không tồn tại: {file_path}")
        return None

    import time
    import random
    import string

    # Tách tên file và phần mở rộng
    path_obj = Path(file_path)
    base_name = path_obj.stem
    ext = path_obj.suffix

    # Lấy timestamp theo milliseconds
    timestamp = int(time.time() * 1000)

    # Random 6 ký tự (chữ thường + số)
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=6))

    # Format: teky-school/basename_timestamp_random.ext
    # Ví dụ: teky-school/sticker8_1785208940146_49b61u.png
    s3_key = f"{S3_PREFIX}/{base_name}_{timestamp}_{random_str}{ext}"

    if not content_type:
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = "application/octet-stream"

    try:
        s3_client.upload_file(
            file_path,
            S3_BUCKET,
            s3_key,
            ExtraArgs={
                'ContentType': content_type,
                'ACL': 'public-read' # Đặt quyền xem công khai cho ảnh
            }
        )
        return f"{S3_PUBLIC_BASE}/{s3_key}"
    except (NoCredentialsError, ClientError) as e:
        print(f"[S3] Lỗi upload: {e}")
        return None
