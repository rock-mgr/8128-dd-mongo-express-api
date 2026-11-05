const bcrypt = require('bcrypt');
const { ObjectId } = require('mongodb');
const { connect } = require('./db');
const jwt = require('jsonwebtoken');
const { GoogleGenAI } = require('@google/genai');

const express = require("express");
const cors = require("cors");
require("dotenv").config();
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const mongoUri = process.env.MONGO_URI;
const dbname = "recipe_book";

const app = express();

app.use(express.json());
app.use(cors());

const generateAccessToken = (id, email) => {
    return jwt.sign({
        'user_id': id,
        'email': email
    }, process.env.TOKEN_SECRET, {
        expiresIn: "1h"
    });
};


const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) return res.sendStatus(403);

    jwt.verify(token, process.env.TOKEN_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);

        req.user = user;
        next();
    });
};


async function main() {
    try {
        const db = await connect(mongoUri, dbname);
        console.log('Connected to MongoDB');

        app.get("/", function (req, res) {
            res.json({
                message: "Hello World!"
            });
        });

        app.get('/ai/test', async (req, res) => {
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite',
                    contents: 'Reply with exactly: Gemini connection successful'
                });

                res.json({
                    message: response.text
                });
            } catch (error) {
                console.error('Gemini error:', error);
                res.status(500).json({
                    error: 'Gemini request failed'
                });
            }
        });


        app.get('/ai/recipes', verifyToken, async (req, res) => {
            try {
                const search = req.query.search;

                if (!search) {
                    return res.status(400).json({
                        error: 'Search query is required'
                    });
                }

                // Ask Gemini to interpret the natural-language search
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite',
                    contents: `
                Convert this recipe search into JSON filters.

                Search: ${JSON.stringify(search)}

                Return only a JSON object with these optional fields:
                name, cuisine, ingredients, tags.

                Each field must be a string.
                Example:
                {"cuisine":"Italian","ingredients":"tomato"}

                Do not include Markdown or explanations.
            `,
                    config: {
                        responseMimeType: 'application/json'
                    }
                });

                const filters = JSON.parse(response.text);

                // Only accept supported filter fields
                const query = {};

                if (typeof filters.name === 'string') {
                    query.name = { $regex: filters.name, $options: 'i' };
                }

                if (typeof filters.cuisine === 'string') {
                    query['cuisine.name'] = {
                        $regex: filters.cuisine,
                        $options: 'i'
                    };
                }

                if (typeof filters.ingredients === 'string') {
                    query['ingredients.name'] = {
                        $regex: filters.ingredients,
                        $options: 'i'
                    };
                }

                if (typeof filters.tags === 'string') {
                    query['tags.name'] = {
                        $regex: filters.tags,
                        $options: 'i'
                    };
                }

                const recipes = await db.collection('recipes')
                    .find(query)
                    .limit(20)
                    .toArray();

                res.json({ filters, recipes });

            } catch (error) {
                console.error('AI recipe search error:', error);

                res.status(500).json({
                    error: 'AI recipe search failed'
                });
            }
        });


        app.post('/ai/recipes', verifyToken, async (req, res) => {
            try {
                const description = req.body.description;

                if (typeof description !== 'string' || !description.trim()) {
                    return res.status(400).json({
                        error: 'Recipe description is required'
                    });
                }

                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite',
                    contents: `
                Convert the following recipe description into JSON.

                Description: ${JSON.stringify(description)}

                Return a JSON object with:
                - name: string
                - cuisine: object with a name field
                - ingredients: array of objects with name fields
                - tags: array of objects with name fields
                - instructions: array of strings

                Return only JSON, without Markdown.
            `,
                    config: {
                        responseMimeType: 'application/json'
                    }
                });

                const recipe = JSON.parse(response.text);

                // Check Gemini's output before saving
                if (
                    !recipe ||
                    typeof recipe.name !== 'string' ||
                    !recipe.name.trim() ||
                    !recipe.cuisine ||
                    typeof recipe.cuisine.name !== 'string' ||
                    !Array.isArray(recipe.ingredients) ||
                    !recipe.ingredients.every(
                        item => item && typeof item.name === 'string'
                    ) ||
                    !Array.isArray(recipe.tags) ||
                    !recipe.tags.every(
                        item => item && typeof item.name === 'string'
                    ) ||
                    !Array.isArray(recipe.instructions) ||
                    !recipe.instructions.every(
                        item => typeof item === 'string'
                    )
                ) {
                    return res.status(502).json({
                        error: 'Gemini returned an invalid recipe structure'
                    });
                }

                const result = await db.collection('recipes').insertOne({
                    name: recipe.name,
                    cuisine: { name: recipe.cuisine.name },
                    ingredients: recipe.ingredients.map(item => ({
                        name: item.name
                    })),
                    tags: recipe.tags.map(item => ({
                        name: item.name
                    })),
                    instructions: recipe.instructions
                });

                res.status(201).json({
                    message: 'AI recipe created successfully',
                    insertedId: result.insertedId
                });

            } catch (error) {
                console.error('AI recipe creation error:', error);

                res.status(500).json({
                    error: 'AI recipe creation failed'
                });
            }
        });


        app.get('/recipes', async (req, res) => {
            try {
                const { tags, cuisine, ingredients, name } = req.query;
                let query = {};

                if (tags) {
                    query['tags.name'] = { $in: tags.split(',') };
                }

                if (cuisine) {
                    query['cuisine.name'] = {
                        $regex: cuisine,
                        $options: 'i'
                    };
                }

                if (ingredients) {
                    query['ingredients.name'] = {
                        $all: ingredients.split(',').map(
                            i => new RegExp(i, 'i')
                        )
                    };
                }

                if (name) {
                    query.name = {
                        $regex: name,
                        $options: 'i'
                    };
                }

                const recipes = await db.collection('recipes')
                    .find(query)
                    .project({
                        name: 1,
                        'cuisine.name': 1,
                        'tags.name': 1,
                        _id: 0
                    })
                    .toArray();

                res.json({ recipes });
            } catch (error) {
                console.error('Error searching recipes:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });



        app.get('/recipes/:id', async (req, res) => {
            try {
                const id = req.params.id;

                const recipe = await db.collection('recipes').findOne(
                    { _id: new ObjectId(id) },
                    { projection: { _id: 0 } }
                );

                if (!recipe) {
                    return res.status(404).json({
                        error: 'Recipe not found'
                    });
                }

                res.json(recipe);
            } catch (error) {
                console.error('Error fetching recipe:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });

        app.post('/recipes', async (req, res) => {
            try {
                const newRecipe = req.body;

                const result = await db.collection('recipes')
                    .insertOne(newRecipe);

                res.status(201).json({
                    message: 'Recipe created successfully',
                    insertedId: result.insertedId
                });
            } catch (error) {
                console.error('Error creating recipe:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });

        app.put('/recipes/:id', async (req, res) => {
            try {
                const recipeId = req.params.id;
                const { name, cuisine, prepTime, cookTime, servings, ingredients, instructions, tags } = req.body;

                // Basic validation
                if (!name || !cuisine || !ingredients || !instructions || !tags) {
                    return res.status(400).json({ error: 'Missing required fields' });
                }

                // Fetch the cuisine document
                const cuisineDoc = await db.collection('cuisines').findOne({ name: cuisine });
                if (!cuisineDoc) {
                    return res.status(400).json({ error: 'Invalid cuisine' });
                }

                // Fetch the tag documents
                const tagDocs = await db.collection('tags').find({ name: { $in: tags } }).toArray();
                if (tagDocs.length !== tags.length) {
                    return res.status(400).json({ error: 'One or more invalid tags' });
                }

                // Create the updated recipe object
                const updatedRecipe = {
                    name,
                    cuisine: {
                        _id: cuisineDoc._id,
                        name: cuisineDoc.name
                    },
                    prepTime,
                    cookTime,
                    servings,
                    ingredients,
                    instructions,
                    tags: tagDocs.map(tag => ({
                        _id: tag._id,
                        name: tag.name
                    }))
                };

                // Update the recipe in the database
                const result = await db.collection('recipes').replaceOne(
                    { _id: new ObjectId(recipeId) },
                    updatedRecipe
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({ error: 'Recipe not found' });
                }

                // Send back the success response
                res.json({
                    message: 'Recipe updated successfully'
                });
            } catch (error) {
                console.error('Error updating recipe:', error);
                res.status(500).json({ error: 'Internal server error' });
            }
        });


        app.delete('/recipes/:id', async (req, res) => {
            try {
                const recipeId = req.params.id;

                const result = await db.collection('recipes').deleteOne({
                    _id: new ObjectId(recipeId)
                });

                if (result.deletedCount === 0) {
                    return res.status(404).json({
                        error: 'Recipe not found'
                    });
                }

                res.json({
                    message: 'Recipe deleted successfully'
                });
            } catch (error) {
                console.error('Error deleting recipe:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });


        app.post('/recipes/:id/reviews', async (req, res) => {
            try {
                const recipeId = req.params.id;
                const { user, rating, comment } = req.body;

                // Basic validation
                if (!user || !rating || !comment) {
                    return res.status(400).json({
                        error: 'Missing required fields'
                    });
                }

                // Create the new review object
                const newReview = {
                    review_id: new ObjectId(),
                    user,
                    rating: Number(rating),
                    comment,
                    date: new Date()
                };

                // Add the review to the recipe
                const result = await db.collection('recipes').updateOne(
                    { _id: new ObjectId(recipeId) },
                    { $push: { reviews: newReview } }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({
                        error: 'Recipe not found'
                    });
                }

                res.status(201).json({
                    message: 'Review added successfully',
                    reviewId: newReview.review_id
                });
            } catch (error) {
                console.error('Error adding review:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });


        app.put('/recipes/:recipeId/reviews/:reviewId', async (req, res) => {
            try {
                const recipeId = req.params.recipeId;
                const reviewId = req.params.reviewId;
                const { user, rating, comment } = req.body;

                if (!user || !rating || !comment) {
                    return res.status(400).json({
                        error: 'Missing required fields'
                    });
                }

                const updatedReview = {
                    review_id: new ObjectId(reviewId),
                    user,
                    rating: Number(rating),
                    comment,
                    date: new Date()
                };

                const result = await db.collection('recipes').updateOne(
                    {
                        _id: new ObjectId(recipeId),
                        "reviews.review_id": new ObjectId(reviewId)
                    },
                    {
                        $set: { "reviews.$": updatedReview }
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({
                        error: 'Recipe or review not found'
                    });
                }

                res.json({
                    message: 'Review updated successfully',
                    reviewId: reviewId
                });
            } catch (error) {
                console.error('Error updating review:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });


        app.delete('/recipes/:recipeId/reviews/:reviewId', async (req, res) => {
            try {
                const recipeId = req.params.recipeId;
                const reviewId = req.params.reviewId;

                const result = await db.collection('recipes').updateOne(
                    { _id: new ObjectId(recipeId) },
                    {
                        $pull: {
                            reviews: { review_id: new ObjectId(reviewId) }
                        }
                    }
                );

                if (result.matchedCount === 0) {
                    return res.status(404).json({
                        error: 'Recipe not found'
                    });
                }

                if (result.modifiedCount === 0) {
                    return res.status(404).json({
                        error: 'Review not found'
                    });
                }

                res.json({
                    message: 'Review deleted successfully'
                });
            } catch (error) {
                console.error('Error deleting review:', error);
                res.status(500).json({
                    error: 'Internal server error'
                });
            }
        });


        app.post('/users', async function (req, res) {
            const result = await db.collection("users").insertOne({
                'email': req.body.email,
                'password': await bcrypt.hash(req.body.password, 12)
            });

            res.status(201).json({
                "message": "New user account",
                "result": result
            });
        });


        app.post('/login', async (req, res) => {
            const { email, password } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    message: 'Email and password are required'
                });
            }

            const user = await db.collection('users').findOne({
                email: email
            });

            if (!user) {
                return res.status(404).json({
                    message: 'User not found'
                });
            }

            const isPasswordValid = await bcrypt.compare(
                password,
                user.password
            );

            if (!isPasswordValid) {
                return res.status(401).json({
                    message: 'Invalid password'
                });
            }

            const accessToken = generateAccessToken(
                user._id,
                user.email
            );

            res.json({ accessToken: accessToken });
        });


        app.get('/protected-route', verifyToken, (req, res) => {
            res.json({
                message: "You have accessed a protected route!",
                user: req.user
            });
        });

        app.get('/profile', verifyToken, (req, res) => {
            res.json({
                message: 'This is a protected route',
                user: req.user
            });
        });

        app.listen(3000, () => {
            console.log("Server has started");
        });

    } catch (error) {
        console.error('Error connecting to MongoDB', error);
    }
}

main();
