var fs = require('fs');
var express = require('express');
var http = require('http');
https = require('https');
var ejs = require('ejs');
var request = require('request');

//Using SSL because we're sending over GitHub end-user access tokens over the wire
var ssl_options = {
	key: fs.readFileSync(__dirname + '/ssl_stuff/reporanker_com.key', 'utf8'),
	cert: fs.readFileSync(__dirname + '/ssl_stuff/reporanker.ca-bundle', 'utf8')
};

var app = express();
app.use(express.cookieParser());
app.use(express.bodyParser());
app.disable('x-powered-by');

app.configure(function(){
	app.use('/static', express.static(__dirname + '/static'));
	app.use(app.router);
});

var server = https.createServer(ssl_options, app).listen(443);

//GitHub app tokens:
var clientId = "YOUR_APP_CLIENT_ID";
var secret = "YOUR_APP_SECRET";

var repos = [];
try { repos = JSON.parse(fs.readFileSync(__dirname + '/repos.json', 'utf8')); } catch (err) { console.log('repos not found'); };

var repo_editor = fs.readFileSync(__dirname + '/views/repo_editor.html', 'utf8');
var repo_voter = fs.readFileSync(__dirname + '/views/repo_voter.html', 'utf8');

setInterval(function(){
	repo_editor = fs.readFileSync(__dirname + '/views/repo_editor.html', 'utf8');
	repo_voter = fs.readFileSync(__dirname + '/views/repo_voter.html', 'utf8');
},3000);


app.get('/', cookieAuth, function (req, res) {
	res.send(ejs.render(repo_voter, {username: req.cookies.reporanker.github_username, starred_something: (req.cookies.reporanker_history ? true : false)}));
});

app.get('/auth-github', function (req, res) {
	res.redirect('https://github.com/login/oauth/authorize?client_id=' + clientId + '&scope=public_repo');
});

app.get('/edit-repo-list', cookieAuth, function (req, res) {
	getRepoList(req.cookies.reporanker.github_access_token, req.cookies.reporanker.github_username, function(err, temp_repos){
		addRepos(temp_repos);
		res.send(ejs.render(repo_editor, {'your_repos': getUserRepos(req.cookies.reporanker.github_username)}));
	});
});

app.get('/get-repo', function (req, res) {
	res.send({ok:true, repo: findRandomRepo(req)});
});

app.post('/set-ranking', cookieAuth, function (req, res) {
	if (Object.prototype.toString.call(req.body) === '[object Array]' ) {
		for (var i = 0; i < req.body.length; i++) {
			for (var j = 0; j < repos.length; j++) {
				if (repos[j].id == req.body[i].repoId && req.cookies.reporanker.github_username == repos[j].owner){
					repos[j].rank = i;
				}
			}
		}
	}
	fs.writeFileSync(__dirname + '/repos.json', JSON.stringify(repos));
	res.send({ok:true});
});

app.get('/star', cookieAuth, function (req, res) {
	if (!req.query || !req.query.repo_id) return res.send({ok:false, error: 'Missing repo id'});
	for (var i = 0; i < repos.length; i++) {
		if (repos[i].id == req.query.repo_id){
			repos[i].stargazers_count++;
			starRepo(req, res, repos[i], function(err, response){
				if (err) return res.send({ok:false, error: err});
				res.send({ok:true});
			});
			return;
		}
	}
	res.send({ok:false, error:'Repo not found'});
});

app.get('/github-callback', function (req, res) {
	if (req.query && req.query.code){
		request.post('https://github.com/login/oauth/access_token?client_id=' + clientId + '&client_secret=' + secret + '&code=' + req.query.code, function(err, response, body){
			var access_token = body.substr(13);
			access_token = access_token.substr(0, access_token.indexOf('&scope'));
			
			verifyUser(access_token, function(err, username){
				console.log('New user: ' + username);
				res.cookie('reporanker', { github_access_token: access_token, github_username: username }, { expires: new Date(new Date().getTime()+99396409000) });
				setTimeout(function(){
					res.redirect('/');
				},500);
			});
		});
	} else {
		res.send('Something went wrong');
	}
});



function starRepo(req, res, repo, callback){
	request.put({
		url: 'https://api.github.com/user/starred/' + repo.owner + '/' + repo.name + '?access_token=' + req.cookies.reporanker.github_access_token,
		headers: {'User-Agent': 'reporanker'}
	}, function(err, response, body){
		addToHistoryCookie(req, res, repo.id, function(){
			callback(null, body);
		});
	});
}

function getUserRepos(username){
	var temp_repos = [];
	for (var i = 0; i < repos.length; i++) {
		if (repos[i].owner == username){
			temp_repos.push(repos[i]);
		}
	}
	temp_repos.sort(function(a,b) {
		return a.rank - b.rank;
	});
	return temp_repos;
}

function cookieAuth(req, res, next){
	if (req.cookies && req.cookies.reporanker && req.cookies.reporanker.github_username){
		return next();
	} else {
		return res.send(fs.readFileSync(__dirname + '/views/logged_out.html', 'utf8'));
	}
}

function addToHistoryCookie(req, res, starred_id, callback){
	if (req.cookies && req.cookies.reporanker_history && req.cookies.reporanker_history.starred){
		var temp_new_starred_array = req.cookies.reporanker_history.starred.push(starred_id);
		res.cookie('reporanker_history', { starred: temp_new_starred_array }, { expires: new Date(new Date().getTime()+99396409000) });
	} else {
		res.cookie('reporanker_history', { starred: [starred_id] }, { expires: new Date(new Date().getTime()+99396409000) });
	}
	setTimeout(function(){
		return callback();
	},300);
}

function addRepos(new_repos){
	for (var i = 0; i < new_repos.length; i++) {
		var temp_found = false;
		for (var j = 0; j < repos.length; j++) {
			if (repos[j].id == new_repos[i].id){
				temp_found = true;
				repos[j].name = new_repos[i].name;
				repos[j].description = new_repos[i].description;
				repos[j].owner = new_repos[i].owner;
				repos[j].html_url = new_repos[i].html_url;
				repos[j].stargazers_count = new_repos[i].stargazers_count;
				repos[j].last_updated = new Date();
			}
		}
		if (!temp_found){
			repos.push(new_repos[i]);
		}
	}
	fs.writeFileSync(__dirname + '/repos.json', JSON.stringify(repos));
}

function verifyUser(access_token, callback){
	request({
		url: 'https://api.github.com/user?access_token=' + access_token + '&client_id=' + clientId + '&client_secret=' + secret,
		headers: {'User-Agent': 'reporanker'}
	}, function(err, response, body){
		try {
			body = JSON.parse(body);
		} catch(err){
			console.log('JSON parse error');
			return callback('Something went wrong :(', null);
		}
		if (body.login) {
			callback(null, body.login);
		} else {
			return callback('Something went wrong :(', null);
		}
	});
}

function getRepoList(access_token, username, callback){
	request({
		url: 'https://api.github.com/users/' + username + '/repos?access_token=' + access_token + '&client_id=' + clientId + '&client_secret=' + secret + '&per_page=100',
		headers: {'User-Agent': 'reporanker'}
	}, function(err, response, body){
		try {
			body = JSON.parse(body);
		} catch(err){
			console.log('JSON parse error');
			return callback('Something went wrong :(', null);
		}
		if (body) {
			var temp_repos = [];
			for (var i = 0; i < body.length; i++) {
				if (!body[i].private){
					temp_repos.push({
						id: body[i].id,
						name: body[i].name,
						description: body[i].description,
						owner: body[i].owner.login,
						html_url: body[i].html_url,
						stargazers_count: body[i].stargazers_count,
						rank: i,
						last_updated: new Date(),
					});
				}
			}
			callback(null, temp_repos);
		} else {
			return callback('Something went wrong :(', null);
		}
	});
}

function findRandomRepo(req){
	var username = '';
	if (req.cookies && req.cookies.reporanker && req.cookies.reporanker.github_username) username = req.cookies.reporanker.github_username;
	var starred_already = [];
	if (req.cookies && req.cookies.reporanker_history && req.cookies.reporanker_history.starred) starred_already = req.cookies.reporanker_history.starred;
	if (!repos.length) return -1;
	var temp_found = -1;
	temp_outer_loop: for (var j = 0; j < 1000; j++) {
		var random_repo = repos[Math.floor(Math.random() * repos.length)];
		// if (random_repo.owner != req.cookies.reporanker.github_username){
			if (starred_already.indexOf(random_repo.id) == -1){
				if (random_repo.rank < 6){
					for (var i = 0; i < repos.length; i++) {
						if (repos[i].owner == random_repo.owner && repos[i].rank > random_repo.rank && repos[i].stargazers_count >= random_repo.stargazers_count){
							temp_found = random_repo;
							break temp_outer_loop;
						}
					}
				}
			}
		// }
	}
	return temp_found;
}
