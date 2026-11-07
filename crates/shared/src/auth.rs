use argon2::password_hash::{
    rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString,
};
use argon2::Argon2;
use axum::extract::FromRequestParts;
use axum::http::request::Parts;
use chrono::{Duration, Utc};
use jsonwebtoken::{decode, encode, Algorithm, DecodingKey, EncodingKey, Header, Validation};
use rand_core::{OsRng as TokenRng, RngCore};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::config::Config;
use crate::error::{AppError, AppResult};
use crate::models::{Role, User};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Claims {
    pub sub: Uuid,
    pub username: String,
    pub role: String,
    pub exp: i64,
    pub iat: i64,
    pub jti: Uuid,
    pub typ: String,
}

#[derive(Debug, Clone)]
pub struct AuthUser {
    pub id: Uuid,
    pub username: String,
    pub role: Role,
}

impl AuthUser {
    pub fn from_claims(claims: &Claims) -> AppResult<Self> {
        let role = Role::parse(&claims.role)
            .ok_or_else(|| AppError::Unauthorized("invalid role".into()))?;
        Ok(Self {
            id: claims.sub,
            username: claims.username.clone(),
            role,
        })
    }

    pub fn require_admin(&self) -> AppResult<()> {
        if self.role == Role::Admin {
            Ok(())
        } else {
            Err(AppError::Forbidden("administrator role required".into()))
        }
    }

    pub fn require_write(&self) -> AppResult<()> {
        if self.role.can_write() {
            Ok(())
        } else {
            Err(AppError::Forbidden("write access required".into()))
        }
    }
}

impl<S> FromRequestParts<S> for AuthUser
where
    S: Send + Sync,
{
    type Rejection = AppError;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Self::Rejection> {
        parts
            .extensions
            .get::<AuthUser>()
            .cloned()
            .ok_or_else(|| AppError::Unauthorized("authentication required".into()))
    }
}

pub fn hash_password(password: &str) -> AppResult<String> {
    if password.len() < 10 {
        return Err(AppError::Validation(
            "password must be at least 10 characters".into(),
        ));
    }
    if password.len() > 256 {
        return Err(AppError::Validation("password is too long".into()));
    }
    let salt = SaltString::generate(&mut OsRng);
    let argon2 = Argon2::default();
    argon2
        .hash_password(password.as_bytes(), &salt)
        .map(|h| h.to_string())
        .map_err(AppError::from)
}

pub fn verify_password(password: &str, hash: &str) -> bool {
    let parsed = match PasswordHash::new(hash) {
        Ok(p) => p,
        Err(_) => return false,
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

pub fn create_access_token(config: &Config, user: &User) -> AppResult<String> {
    let now = Utc::now();
    let claims = Claims {
        sub: user.id,
        username: user.username.clone(),
        role: user.role.clone(),
        iat: now.timestamp(),
        exp: (now + Duration::minutes(config.access_token_ttl_minutes)).timestamp(),
        jti: Uuid::new_v4(),
        typ: "access".to_string(),
    };
    encode(
        &Header::new(Algorithm::HS256),
        &claims,
        &EncodingKey::from_secret(config.jwt_secret.as_bytes()),
    )
    .map_err(AppError::from)
}

pub fn decode_access_token(config: &Config, token: &str) -> AppResult<Claims> {
    let mut validation = Validation::new(Algorithm::HS256);
    validation.validate_exp = true;
    validation.leeway = 5;
    let data = decode::<Claims>(
        token,
        &DecodingKey::from_secret(config.jwt_secret.as_bytes()),
        &validation,
    )?;
    if data.claims.typ != "access" {
        return Err(AppError::Unauthorized("invalid token type".into()));
    }
    Ok(data.claims)
}

pub fn new_refresh_token() -> (String, String) {
    let mut bytes = [0u8; 48];
    TokenRng.fill_bytes(&mut bytes);
    let token = hex::encode(bytes);
    let hash = hash_token(&token);
    (token, hash)
}

pub fn hash_token(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    hex::encode(hasher.finalize())
}

pub fn refresh_expiry(config: &Config) -> chrono::DateTime<Utc> {
    Utc::now() + Duration::days(config.refresh_token_ttl_days)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn password_roundtrip() {
        let hash = hash_password("correct horse battery staple").unwrap();
        assert!(verify_password("correct horse battery staple", &hash));
        assert!(!verify_password("wrong password", &hash));
    }

    #[test]
    fn rejects_short_password() {
        assert!(hash_password("short").is_err());
    }
}
