use axum::response::Html;

pub async fn index() -> Html<&'static str> {
    Html(include_str!("../../../../web/index.html"))
}

pub async fn app_js() -> ([(&'static str, &'static str); 1], &'static str) {
    (
        [("content-type", "application/javascript; charset=utf-8")],
        include_str!("../../../../web/app.js"),
    )
}
