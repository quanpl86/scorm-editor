import boto3
from botocore.config import Config
from app.s3_service import S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_REGION, S3_BUCKET

s3_client = boto3.client(
    "s3",
    endpoint_url=S3_ENDPOINT,
    aws_access_key_id=S3_ACCESS_KEY,
    aws_secret_access_key=S3_SECRET_KEY,
    region_name=S3_REGION,
    config=Config(signature_version='s3v4', s3={'payload_signing_enabled': False})
)
try:
    with open("test.txt", "w") as f: f.write("test")
    s3_client.upload_file("test.txt", S3_BUCKET, "teky-school/test2.txt")
    print("SUCCESS")
except Exception as e:
    print("FAILED", e)
