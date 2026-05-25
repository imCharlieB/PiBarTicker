# NFL Groups/Divisions API Example
# This file documents the ESPN endpoint for NFL conferences/divisions

# Endpoint:
#   https://site.api.espn.com/apis/site/v2/sports/football/nfl/groups
#
# This returns a JSON structure with all NFL conferences and divisions.
# Example structure:
# {
#   "groups": [
#     {
#       "id": "1",
#       "name": "AFC",
#       "parentGroupId": null,
#       "groups": [
#         { "id": "6", "name": "AFC East", ... },
#         { "id": "7", "name": "AFC North", ... },
#         ...
#       ]
#     },
#     {
#       "id": "2",
#       "name": "NFC",
#       "parentGroupId": null,
#       "groups": [
#         { "id": "10", "name": "NFC East", ... },
#         { "id": "11", "name": "NFC North", ... },
#         ...
#       ]
#     }
#   ]
# }
#
# Use this endpoint to populate conference/division selectors in the setup UI.
