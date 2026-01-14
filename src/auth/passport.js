const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const GitHubStrategy = require('passport-github2').Strategy;
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const bcrypt = require('bcryptjs');
const { User } = require('../db');

// Serialize user for session
passport.serializeUser((user, done) => {
    done(null, user.id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findByPk(id);
        done(null, user);
    } catch (err) {
        done(err, null);
    }
});

// Local Strategy
passport.use(new LocalStrategy(async (username, password, done) => {
    try {
        const user = await User.findOne({ where: { username } });
        if (!user) {
            return done(null, false, { message: 'Incorrect username.' });
        }
        if (!user.password_hash) {
            return done(null, false, { message: 'Please log in with your social account.' });
        }
        const isMatch = await bcrypt.compare(password, user.password_hash);
        if (!isMatch) {
            return done(null, false, { message: 'Incorrect password.' });
        }
        return done(null, user);
    } catch (err) {
        return done(err);
    }
}));

// GitHub Strategy
if (process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET) {
    passport.use(new GitHubStrategy({
            clientID: process.env.GITHUB_CLIENT_ID,
            clientSecret: process.env.GITHUB_CLIENT_SECRET,
            callbackURL: "/auth/github/callback"
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                // Check if user exists with this provider ID
                let user = await User.findOne({
                    where: { provider: 'github', provider_id: profile.id }
                });

                if (!user) {
                    // Check if email exists (optional, depends on if we want to merge)
                    // For simplicity, just create new user
                    // Ensure username is unique
                    let baseUsername = profile.username;
                    let username = baseUsername;
                    let counter = 1;
                    while (await User.findOne({ where: { username } })) {
                        username = `${baseUsername}${counter}`;
                        counter++;
                    }

                    user = await User.create({
                        username: username,
                        email: profile.emails?.[0]?.value,
                        provider: 'github',
                        provider_id: profile.id
                    });
                }
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    ));
}

// Google Strategy
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
    passport.use(new GoogleStrategy({
            clientID: process.env.GOOGLE_CLIENT_ID,
            clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            callbackURL: "/auth/google/callback"
        },
        async (accessToken, refreshToken, profile, done) => {
            try {
                let user = await User.findOne({
                    where: { provider: 'google', provider_id: profile.id }
                });

                if (!user) {
                     let baseUsername = profile.displayName.replace(/\s+/g, '').toLowerCase();
                    let username = baseUsername;
                    let counter = 1;
                    while (await User.findOne({ where: { username } })) {
                        username = `${baseUsername}${counter}`;
                        counter++;
                    }

                    user = await User.create({
                        username: username,
                        email: profile.emails?.[0]?.value,
                        provider: 'google',
                        provider_id: profile.id
                    });
                }
                return done(null, user);
            } catch (err) {
                return done(err);
            }
        }
    ));
}

module.exports = passport;
