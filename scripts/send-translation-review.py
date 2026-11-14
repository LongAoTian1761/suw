"""Send a local translation review alert using a configured SMTP account."""
import json
import os
import smtplib
import ssl
import sys
from email.message import EmailMessage


def main():
    config = json.loads(os.environ["SUW_REVIEW_SMTP"].lstrip("\ufeff"))
    notice = json.load(sys.stdin)
    password = os.environ["SUW_REVIEW_SMTP_PASSWORD"]
    message = EmailMessage()
    message["From"] = config["sender"]
    message["To"] = config["recipient"]
    message["Subject"] = "国际宏观译文待修 · " + str(notice["exercise"])
    count = notice["blocks"]
    message.set_content(
        f"习题 {notice['exercise']} · 待修段落 {count} 处。" if count else
        f"习题 {notice['exercise']} · 正文翻译任务失败。"
    )
    context = ssl.create_default_context()
    host, port = config["host"], int(config["port"])
    if config["mode"] == "ssl":
        connection = smtplib.SMTP_SSL(host, port, timeout=15, context=context)
    elif config["mode"] == "starttls":
        connection = smtplib.SMTP(host, port, timeout=15)
    else:
        raise ValueError("Unsupported SMTP mode")
    with connection:
        if config["mode"] == "starttls":
            connection.starttls(context=context)
        connection.login(config["sender"], password)
        connection.send_message(message)


if __name__ == "__main__":
    main()
