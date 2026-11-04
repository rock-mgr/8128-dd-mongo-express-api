const express = require("express");
const app = express();

app.get("/", (req, res) => {
    //res.send("Hello World!");
    res.send("Hello from Express!");
});

app.get('/echo', (req, res) => {
    // Get all query parameters
    const queryParams = req.query;

    // Create a response object
    const response = {
        message: "Here are the query parameters you sent:",
        firstName: queryParams.firstName,
        lastName: queryParams.lastName
    };

    // Send the response as JSON
    res.json(response);
});


app.get('/hello/:name', (req, res) => {
    let name = req.params.name;
    res.send("Hi, " + name);
});

app.get('/difference/:n1/:n2', (req, res) => {
    const n1 = Number(req.params.n1);
    const n2 = Number(req.params.n2);

    const difference = n1 - n2;

    res.send("Difference: " + difference);
});

app.get('/scream', (req, res) => {
    const message = req.query.message;
    const recipient = req.query.recipient;

    const result = (message + " " + recipient).toUpperCase();

    res.send(result);
});

app.listen(3000, () => {
    console.log("Server running on port 3000");
});