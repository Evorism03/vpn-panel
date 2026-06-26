"""SMTP email notifications — fire-and-forget via background thread."""
import logging
import smtplib
import ssl
import threading
from email import encoders
from email.mime.base import MIMEBase
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..config import get_settings

cfg = get_settings()
log = logging.getLogger(__name__)


def is_configured() -> bool:
    return bool(cfg.smtp_host and cfg.smtp_user and cfg.smtp_password and cfg.smtp_from)


def _send_sync(to: str, subject: str, body: str,
               attachment: tuple | None = None):
    """Blocking send. attachment = (filename, bytes, mimetype_str)."""
    if not is_configured():
        return
    msg = MIMEMultipart()
    msg["From"]    = cfg.smtp_from
    msg["To"]      = to
    msg["Subject"] = subject
    msg.attach(MIMEText(body, "plain", "utf-8"))

    if attachment:
        fname, content, mime = attachment
        major, minor = mime.split("/", 1)
        part = MIMEBase(major, minor)
        part.set_payload(content)
        encoders.encode_base64(part)
        part.add_header("Content-Disposition", f'attachment; filename="{fname}"')
        msg.attach(part)

    try:
        ctx = ssl.create_default_context() if cfg.smtp_tls else None
        with smtplib.SMTP(cfg.smtp_host, cfg.smtp_port, timeout=15) as s:
            if cfg.smtp_tls:
                s.starttls(context=ctx)
            s.login(cfg.smtp_user, cfg.smtp_password)
            s.sendmail(cfg.smtp_from, to, msg.as_string())
        log.debug("Email sent to %s: %s", to, subject)
    except Exception as e:
        log.warning("Email send failed to %s: %s", to, e)


def _send_bg(to: str, subject: str, body: str, attachment=None):
    threading.Thread(
        target=_send_sync, args=(to, subject, body, attachment), daemon=True,
    ).start()


def _cabinet_base() -> str:
    url = cfg.lava_success_url
    idx = url.find("/cabinet")
    return url[:idx] if idx != -1 else url.rstrip("/")


def send_order_confirmation(to: str, client_id: str, client_name: str,
                             config_text: str, expires_at: str | None):
    """Fire-and-forget: send config file after a new order is issued."""
    if not to or not is_configured():
        return
    expiry_line = f"Активна до: {expires_at}" if expires_at else "Бессрочная подписка"
    subject = f"{cfg.panel_name} — Ваше подключение готово"
    body = (
        f"Здравствуйте, {client_name}!\n\n"
        f"Ваша VPN-подписка успешно оформлена.\n\n"
        f"{expiry_line}\n"
        f"Ваш ID клиента: {client_id}\n\n"
        f"Войдите в личный кабинет: {_cabinet_base()}/cabinet\n"
        f"(используйте ID клиента: {client_id})\n\n"
        f"Конфигурационный файл прикреплён к письму.\n\n"
        f"---\n{cfg.panel_name}"
    )
    attachment = (f"{client_name}.conf", config_text.encode("utf-8"), "text/plain")
    _send_bg(to, subject, body, attachment)


def send_renewal_confirmation(to: str, client_id: str, client_name: str,
                               expires_at: str | None):
    """Fire-and-forget: notify client that their subscription was renewed."""
    if not to or not is_configured():
        return
    expiry_line = f"Активна до: {expires_at}" if expires_at else "Бессрочная подписка"
    subject = f"{cfg.panel_name} — Подписка продлена"
    body = (
        f"Здравствуйте, {client_name}!\n\n"
        f"Ваша VPN-подписка успешно продлена.\n\n"
        f"{expiry_line}\n\n"
        f"Личный кабинет: {_cabinet_base()}/cabinet\n"
        f"ID клиента: {client_id}\n\n"
        f"---\n{cfg.panel_name}"
    )
    _send_bg(to, subject, body)


def send_expiry_reminder(to: str, client_id: str, client_name: str,
                          expires_at: str, days_left: int):
    """Fire-and-forget: remind client about upcoming expiry."""
    if not to or not is_configured():
        return
    subject = f"{cfg.panel_name} — Подписка истекает через {days_left} дн."
    body = (
        f"Здравствуйте, {client_name}!\n\n"
        f"Ваша VPN-подписка истекает через {days_left} дней ({expires_at}).\n\n"
        f"Продлите подписку в личном кабинете:\n"
        f"{_cabinet_base()}/cabinet\n\n"
        f"Ваш ID клиента: {client_id}\n\n"
        f"---\n{cfg.panel_name}"
    )
    _send_bg(to, subject, body)
