use std::net::{IpAddr, SocketAddr};

use axum::extract::ConnectInfo;
use axum::http::{HeaderMap, HeaderValue, Request};
use axum::middleware::Next;
use axum::response::Response;
use url::Url;

use crate::error::{AppError, AppResult};
use crate::text::is_public_ip;

const MAX_URL_LEN: usize = 2048;

pub async fn security_headers(request: Request<axum::body::Body>, next: Next) -> Response {
    let mut response = next.run(request).await;
    let headers = response.headers_mut();

    headers
        .entry("content-security-policy")
        .or_insert(HeaderValue::from_static(
            "default-src 'self'; \
             script-src 'self' 'sha256-0QByiwckHM2UCphp5K1A0jZOeeMw9uouubKhB8hUEAk='; \
             style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; \
             frame-ancestors 'none'; base-uri 'self'; form-action 'self'; \
             object-src 'none'",
        ));
    headers.insert(
        "strict-transport-security",
        HeaderValue::from_static("max-age=31536000; includeSubDomains"),
    );
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert(
        "permissions-policy",
        HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()"),
    );
    headers.insert(
        "cross-origin-opener-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "cross-origin-resource-policy",
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        "x-permitted-cross-domain-policies",
        HeaderValue::from_static("none"),
    );

    response
}

pub fn client_ip(
    headers: &HeaderMap,
    peer: Option<SocketAddr>,
    trust_proxy_headers: bool,
) -> String {
    if trust_proxy_headers {
        if let Some(value) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
            if let Some(first) = value.split(',').next() {
                let candidate = first.trim();
                if candidate.parse::<IpAddr>().is_ok() {
                    return candidate.to_string();
                }
            }
        }
        if let Some(value) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
            if value.parse::<IpAddr>().is_ok() {
                return value.to_string();
            }
        }
    }
    peer.map(|p| p.ip().to_string()).unwrap_or_default()
}

pub fn peer_from_parts(parts: &axum::http::request::Parts) -> Option<SocketAddr> {
    parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|c| c.0)
}

pub async fn validate_public_url(raw: &str, allowed_hosts: &[String]) -> AppResult<Url> {
    if raw.len() > MAX_URL_LEN {
        return Err(AppError::UnsafeUrl("url is too long".into()));
    }
    let url = Url::parse(raw.trim()).map_err(|_| AppError::UnsafeUrl("invalid url".into()))?;

    match url.scheme() {
        "http" | "https" => {}
        _ => {
            return Err(AppError::UnsafeUrl(
                "only http and https are allowed".into(),
            ))
        }
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(AppError::UnsafeUrl(
            "credentials in url are not allowed".into(),
        ));
    }
    let host = url
        .host_str()
        .ok_or_else(|| AppError::UnsafeUrl("host is required".into()))?
        .trim_end_matches('.')
        .to_lowercase();

    if host.is_empty()
        || host == "localhost"
        || host.ends_with(".localhost")
        || host.ends_with(".local")
        || host.ends_with(".internal")
        || host.ends_with(".lan")
        || host.ends_with(".home")
        || host.ends_with(".corp")
    {
        return Err(AppError::UnsafeUrl(
            "private host name is not allowed".into(),
        ));
    }

    if !allowed_hosts.is_empty() {
        let allowed = allowed_hosts
            .iter()
            .any(|allowed| host == *allowed || host.ends_with(&format!(".{allowed}")));
        if !allowed {
            return Err(AppError::UnsafeUrl("host is not in allowlist".into()));
        }
    }

    let port = url
        .port_or_known_default()
        .ok_or_else(|| AppError::UnsafeUrl("port is required".into()))?;
    if port != 80 && port != 443 {
        return Err(AppError::UnsafeUrl(
            "only ports 80 and 443 are allowed".into(),
        ));
    }

    if let Ok(ip) = host.parse::<IpAddr>() {
        if !is_public_ip(ip) {
            return Err(AppError::UnsafeUrl("private ip is not allowed".into()));
        }
        return Ok(url);
    }

    let mut addrs = tokio::net::lookup_host((host.as_str(), port))
        .await
        .map_err(|_| AppError::UnsafeUrl("dns resolution failed".into()))?;
    let mut found = false;
    for addr in addrs.by_ref() {
        found = true;
        if !is_public_ip(addr.ip()) {
            return Err(AppError::UnsafeUrl("host resolves to a private ip".into()));
        }
    }
    if !found {
        return Err(AppError::UnsafeUrl("host did not resolve".into()));
    }

    Ok(url)
}

pub fn sanitize_filename(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next().unwrap_or(name).trim();
    if base.is_empty() || base.len() > 180 {
        return None;
    }
    let mut out = String::with_capacity(base.len());
    for ch in base.chars() {
        if ch.is_alphanumeric() || matches!(ch, '.' | '-' | '_') {
            out.push(ch);
        } else if ch.is_whitespace() {
            out.push('_');
        }
    }
    let out = out.trim_matches('.').to_string();
    if out.is_empty() || out == "." || out == ".." {
        return None;
    }
    Some(out)
}

pub fn validate_username(username: &str) -> AppResult<()> {
    let valid = (3..=64).contains(&username.len())
        && username
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'));
    if valid {
        Ok(())
    } else {
        Err(AppError::Validation(
            "username must be 3-64 characters: letters, digits, dot, dash, underscore".into(),
        ))
    }
}

pub fn validate_password(password: &str) -> AppResult<()> {
    if password.len() < 8 {
        return Err(AppError::Validation(
            "password must be at least 8 characters".into(),
        ));
    }
    if password.len() > 256 {
        return Err(AppError::Validation("password is too long".into()));
    }
    let has_letter = password.chars().any(|c| c.is_alphabetic());
    let has_digit = password.chars().any(|c| c.is_ascii_digit());
    if !has_letter || !has_digit {
        return Err(AppError::Validation(
            "password must contain at least one letter and one digit".into(),
        ));
    }
    Ok(())
}

pub fn validate_role(role: &str) -> AppResult<()> {
    match role {
        "admin" | "user" => Ok(()),
        _ => Err(AppError::Validation("invalid role".into())),
    }
}

pub fn validate_source_kind(kind: &str) -> AppResult<()> {
    match kind {
        "rss" | "html" => Ok(()),
        _ => Err(AppError::Validation(
            "source kind must be rss or html".into(),
        )),
    }
}

pub fn validate_trust(trust: &str) -> AppResult<()> {
    match trust {
        "primary" | "reprint" | "unknown" => Ok(()),
        _ => Err(AppError::Validation("invalid trust level".into())),
    }
}

pub fn redact_secret(value: &str) -> String {
    if value.len() <= 4 {
        return "***".to_string();
    }
    format!("{}***", &value[..2])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_filenames() {
        assert_eq!(sanitize_filename("../../etc/passwd").unwrap(), "passwd");
        assert_eq!(sanitize_filename(" digest.md ").unwrap(), "digest.md");
        assert_eq!(
            sanitize_filename("новости за ноябрь.zip").unwrap(),
            "новости_за_ноябрь.zip"
        );
        assert!(sanitize_filename("..").is_none());
    }

    #[test]
    fn validates_usernames() {
        assert!(validate_username("analyst_1").is_ok());
        assert!(validate_username("a").is_err());
        assert!(validate_username("../admin").is_err());
    }

    #[test]
    fn validates_passwords() {
        assert!(validate_password("long-enough-1").is_ok());
        assert!(validate_password("short1").is_err());
        assert!(validate_password("nodigitshere").is_err());
    }
}
