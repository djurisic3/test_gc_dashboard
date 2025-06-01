// @ts-nocheck

require('dotenv').config();

const connectDB = require('./db');
const Project = require('./models/Project');

connectDB();

const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

const { Queue } = require('bullmq');
const analyzeQueue = new Queue('analyze');

app.post('/analyze/:name', async (req, res) => {
  const repo = await Project.findOne({ name: req.params.name });
  if (!repo) return res.status(404).send('Not found');

  analyzeQueue.add('run', {
    repoUrl: repo.url.replace('https://github.com/', 'https://github.com/').concat('.git'),
    projectId: repo._id,
    commitSha: repo.lastSha      // upiši ranije pri fetch-u
  });

  res.send('Analysis job queued ✅');
});


app.get('/', (req, res) => {
  res.send('Greencode Dashboard Backend radi!');
});

app.get('/projects', async (req, res) => {
  try {
    const response = await axios.get(`https://api.github.com/users/${process.env.GITHUB_USERNAME}/repos`, {
      headers: {
        Authorization: `token ${process.env.GITHUB_TOKEN}`
      }
    });

    const savedProjects = [];

    for (const repo of response.data) {
      const greenScore = calculateGreenScore(repo); // vidi ispod

      const projectData = {
        name: repo.name,
        url: repo.html_url,
        description: repo.description,
        stars: repo.stargazers_count,
        forks: repo.forks_count,
        language: repo.language,
        updated_at: repo.updated_at,
        greenScore
      };

      // Sačuvaj u bazu (update ako već postoji)
      const saved = await Project.findOneAndUpdate(
        { name: repo.name },
        projectData,
        { upsert: true, new: true }
      );

      savedProjects.push(saved);
    }

    res.json(savedProjects);
  } catch (error) {
    console.error('GitHub API error:', error.response?.data || error.message);

    res.status(500).json({ error: 'Greška pri dohvatu GitHub projekata' });
  }
});

function calculateGreenScore(repo) {
  let score = 100;

  if (repo.forks > 50) score -= 10;
  if (repo.stargazers_count < 5) score -= 15;
  if (!repo.language) score -= 20;

  // penalizuj ako nije skoro ažuriran
  const lastUpdated = new Date(repo.updated_at);
  const monthsAgo = (new Date() - lastUpdated) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo > 6) score -= 15;

  return Math.max(score, 0); // nikad ispod 0
}

app.listen(PORT, () => {
  console.log(`Server radi na portu ${PORT}`);
});
