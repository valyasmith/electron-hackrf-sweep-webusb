const {app, BrowserWindow, Menu, MenuItem, screen} = require('electron');
const path = require('path');

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (require('electron-squirrel-startup')) {
    app.quit();
}

const createWindow = () => {
    const isMac = process.platform === 'darwin';
    const template = [
        // { role: 'file' }
        {
            label: 'File',
            submenu: [
                isMac ? {role: 'close'} : {role: 'quit'}
            ]
        },
        // { role: 'viewMenu' }
        {
            id: 'view',
            label: 'View',
            submenu: [
                {role: 'reload'},
                {role: 'forceReload'},
                {role: 'toggleDevTools'},
                {type: 'separator'},
                {role: 'resetZoom'},
                {role: 'zoomIn'},
                {role: 'zoomOut'},
                {type: 'separator'},
                {role: 'togglefullscreen'}
            ]
        },
        // { role: 'windowMenu' }
        {
            label: 'Window',
            submenu: [
                {role: 'minimize'},
                {role: 'zoom'},
                ...(isMac ? [
                    {type: 'separator'},
                    {role: 'front'},
                    {type: 'separator'},
                    {role: 'window'}
                ] : [
                    {role: 'close'}
                ])
            ]
        }
    ];

const windowWidth = 800;
const windowHeight=600;
    // Create the browser window.
    const mainWindow = new BrowserWindow({

        minWidth: windowWidth,
        minHeight: windowHeight,
        width: windowWidth,
        height: windowHeight,
        // width: 800,
        // height: 600,
        webPreferences: {
            // webSecurity: false,
            // nodeIntegration: true,
            // sandbox: false,
            nodeIntegrationInWorker: true,
            preload: path.join(__dirname, 'preload.js'),
        },
        show: false,
    });
    mainWindow.maximize();
    mainWindow.show();

    const menu = Menu.buildFromTemplate(template)
    menu.getMenuItemById('view').submenu.insert(5, new MenuItem({
        label: 'Half Size',
        click: function () {
            mainWindow.unmaximize();
            mainWindow.setPosition(0, 0);
            mainWindow.setSize(Math.ceil(screen.getPrimaryDisplay().size.width / 2), screen.getPrimaryDisplay().size.height, true);
        }
    }));

    Menu.setApplicationMenu(menu)

    // mainWindow.webContents.session.on('select-usb-device', (event, portList, webContents, callback) => {
    //     // console.log('select-usb-device', event, portList, webContents)
    //
    //     //Add listeners to handle ports being added or removed before the callback for `select-serial-port`
    //     //is called.
    //     mainWindow.webContents.session.on('usb-device-added', (event, port) => {
    //         // console.log('usb-device-added FIRED WITH', event, port)
    //         //Optionally update portList to add the new port
    //     })
    //
    //     mainWindow.webContents.session.on('usb-device-removed', (event, port) => {
    //         // console.log('usb-device-removed FIRED WITH', event, port)
    //         //Optionally update portList to remove the port
    //     })
    //
    //     event.preventDefault();
    //     if (callback) {
    //         console.log('portList', portList);
    //         if (portList && portList.length > 0) {
    //             callback(portList[0].portId)
    //         } else {
    //             callback('') //Could not find any matching devices
    //         }
    //     }
    // })

    mainWindow.webContents.session.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
        // console.log('setPermissionCheckHandler', details);
        if (permission === 'usb') {
            //   // Add logic here to determine if permission should be given to allow USB selection
            return true
        }
        return false;
    });

    const deviceFilters = [
        {vendorId: 0x1d50, productId: 0x604b},
        {vendorId: 0x1d50, productId: 0x6089},
        {vendorId: 0x1d50, productId: 0xcc15},
        {vendorId: 0x1fc9, productId: 0x000c},
    ];

    mainWindow.webContents.session.setDevicePermissionHandler((details) => {
        // console.log('setDevicePermissionHandler', details);
        const filteredDevice = deviceFilters.find(df => {
            return details.device.vendorId === df.vendorId && details.device.productId === df.productId;
        });
        return !!filteredDevice;
    })

    // and load the index.html of the app.
    mainWindow.loadFile(path.join(__dirname, 'index.html'));

    // Open the DevTools.
    // mainWindow.webContents.openDevTools();
};

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
