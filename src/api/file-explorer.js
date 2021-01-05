const path = require('path');
const fs = require('fs').promises;
const Joi = require('joi');
const winston = require('winston');
const fileExplorer = require('../util/file-explorer');
const vpath = require('../util/vpath');
const globals = require('../global');

exports.setup = (mstream) => {
  mstream.post("/api/v1/file-explorer", async (req, res) => {
    try {
      var reqData;

      const schema = Joi.object({
        directory: Joi.string().allow("").required(),
        sort: Joi.boolean().default(true)
      });
      reqData = await schema.validateAsync(req.body);
    }catch (err) {
      return res.status(500).json({ error: 'Validation Error' });
    }

    try {
      // Return vpaths if no path is given
      if (reqData.directory === "" || reqData.directory === "/") {
        const directories = [];
        for (let dir of req.user.vpaths) {
          directories.push({ name: dir });
        }
        return res.json({ path: "/", directories: directories, files: [] });
      }

      // Get vPath Info
      const pathInfo = vpath.getVPathInfo(reqData.directory, req.user);
      if (!pathInfo) { throw 'Failed to find vPath'; }

      // Do not allow browsing outside the directory
      if (pathInfo.fullPath.substring(0, pathInfo.basePath.length) !== pathInfo.basePath) {
        winston.warn(`user '${req.user.username}' attempted to access a directory they don't have access to: ${pathInfo.fullPath}`)
        throw 'Access to directory not allowed';
      }

      // get directory contents
      const folderContents =  await fileExplorer.getDirectoryContents(pathInfo.fullPath, globals.program.supportedAudioFiles, reqData.sort);

      // Format directory string for return value
      let returnDirectory = path.join(pathInfo.vpath, pathInfo.relativePath);
      returnDirectory = returnDirectory.replace(/\\/g, "/"); // Formatting for windows paths
      // Make sure we have a slash at the beginning & end
      if (returnDirectory.slice(1) !== "/") { returnDirectory = "/" + returnDirectory; }
      if (returnDirectory.slice(-1) !== "/") { returnDirectory += "/"; }

      res.json({
        path: returnDirectory,
        files: folderContents.files,
        directories: folderContents.directories
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to get directory contents" });
    }
  });

  async function recursiveFileScan(directory, fileList, relativePath, vPath) {
    for (const file of await fs.readdir(directory)) {
      try {
        var stat = await fs.stat(path.join(directory, file));
      } catch (e) { continue; } /* Bad file or permission error, ignore and continue */
    
      if (stat.isDirectory()) {
        await recursiveFileScan(path.join(directory, file), fileList, path.join(relativePath, file), vPath);
      } else {
        const extension = fileExplorer.getFileType(file).toLowerCase();
        if (globals.program.supportedAudioFiles[extension] === true) {
          fileList.push(path.join(vPath, path.join(relativePath, file)).replace(/\\/g, "/"));
        }
      }
    }
    return fileList;
  }

  mstream.post("/api/v1/file-explorer/recursive", async (req, res) => {
    try {
      const schema = Joi.object({ directory: Joi.string().required() });
      await schema.validateAsync(req.body);
    }catch (err) {
      return res.status(500).json({ error: 'Validation Error' });
    }

    try {
      // Get vPath Info
      const pathInfo = vpath.getVPathInfo(req.body.directory, req.user);
      if (!pathInfo) { throw 'Failed to find vPath'; }

      // Do not allow browsing outside the directory
      if (pathInfo.fullPath.substring(0, pathInfo.basePath.length) !== pathInfo.basePath) {
        winston.warn(`user '${req.user.username}' attempted to access a directory they don't have access to: ${pathInfo.fullPath}`)
        throw 'Access to directory not allowed';
      }

      res.json(await recursiveFileScan(pathInfo.fullPath, [], pathInfo.relativePath, pathInfo.vpath));
    } catch (err) {
      console.log(err)
      res.status(500).json({ error: "Failed to get directory contents" });
    }
  });
}