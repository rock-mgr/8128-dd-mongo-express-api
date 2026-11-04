# 8128-dd-mongo-express-api

## SELECT:
curl -s http://localhost:3000/recipes/6aead90ca3df9decc44e173b
echo

## ADD NEW:
curl -i -X PUT http://localhost:3000/recipes/6aead90ca3df9decc44e173b \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Special Fried Rice",
    "cuisine": "Chinese",
    "prepTime": 15,
    "cookTime": 20,
    "servings": 3,
    "ingredients": [
      {"name": "rice", "amount": 3, "unit": "cups"},
      {"name": "eggs", "amount": 2, "unit": "whole"}
    ],
    "instructions": [
      "Heat oil in a wok.",
      "Scramble the eggs.",
      "Add rice and stir-fry.",
      "Season and serve."
    ],
    "tags": ["quick"]
  }'

## DELETE:
curl -s -X DELETE http://localhost:3000/recipes/6aead90ca3df9decc44e173b
echo

## ADD REVIEW:
curl -s -X POST http://localhost:3000/recipes/6aead11ea50c342097ce756b/reviews \
  -H "Content-Type: application/json" \
  -d '{"user":"John","rating":5,"comment":"Delicious recipe!"}'
echo

## UPDATE REVIEW
curl -s -X PUT http://localhost:3000/recipes/6aead11ea50c342097ce756b/reviews/6aeadfeb410280bbfbee571c \
  -H "Content-Type: application/json" \
  -d '{"user":"John","rating":4,"comment":"Very good recipe!"}'
echo

## DELETE REVIEW
curl -s -X DELETE http://localhost:3000/recipes/6aead11ea50c342097ce756b/reviews/6aeadfeb410280bbfbee571c
echo

## JWT PROTECTED ROUTE
curl -i http://localhost:3000/protected-route

## JWT PROFILE
curl -s -i http://localhost:3000/profile \
  -H "Authorization: Bearer $TOKEN"