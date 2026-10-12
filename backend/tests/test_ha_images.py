from app.api.ha_images import DEVICE_IMAGES, image_key_for_model


def test_device_models_pick_their_picture():
    assert image_key_for_model("H2D") == "h2d"
    assert image_key_for_model("AMS 2 Pro") == "ams"
    assert image_key_for_model("AMS HT") == "ams_ht"
    assert image_key_for_model("X1C") is None
    assert image_key_for_model("") is None
    assert {"h2d", "ams", "ams_ht"} <= set(DEVICE_IMAGES)
