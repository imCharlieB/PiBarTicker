import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api import ha_images


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(ha_images, "_cover_dir", lambda: tmp_path)
    app = FastAPI()
    app.include_router(ha_images.router)
    return TestClient(app), tmp_path


def test_a_cover_picture_is_stored_and_served(client):
    c, folder = client
    png = b"\x89PNG\r\n\x1a\n" + b"x" * 50
    r = c.post("/api/v1/ha/cover/image.h2d_cover_image", content=png, headers={"content-type": "image/png"})
    assert r.status_code == 200 and r.json()["bytes"] == len(png)
    got = c.get("/api/v1/ha/cover/image.h2d_cover_image")
    assert got.status_code == 200 and got.content == png and got.headers["content-type"] == "image/png"


def test_a_new_picture_replaces_the_old_one(client):
    c, _ = client
    c.post("/api/v1/ha/cover/image.a", content=b"one", headers={"content-type": "image/jpeg"})
    c.post("/api/v1/ha/cover/image.a", content=b"two", headers={"content-type": "image/jpeg"})
    assert c.get("/api/v1/ha/cover/image.a").content == b"two"


def test_bad_requests_are_refused(client):
    c, _ = client
    assert c.post("/api/v1/ha/cover/image.a", content=b"x", headers={"content-type": "text/html"}).status_code == 415
    assert c.post("/api/v1/ha/cover/image.a", content=b"", headers={"content-type": "image/png"}).status_code == 400
    assert c.post("/api/v1/ha/cover/image.a", content=b"x" * 5_000_001, headers={"content-type": "image/png"}).status_code == 413
    assert c.post("/api/v1/ha/cover/..%2F..%2Fetc", content=b"x", headers={"content-type": "image/png"}).status_code in (400, 404, 405)
    assert c.get("/api/v1/ha/cover/image.nothing").status_code == 404


def test_removing_a_cover_forgets_it(client):
    c, folder = client
    c.post("/api/v1/ha/cover/image.a", content=b"one", headers={"content-type": "image/png"})
    ha_images.remove_cover("image.a")
    assert c.get("/api/v1/ha/cover/image.a").status_code == 404
    ha_images.remove_cover("not an entity")  # ignored, no error
