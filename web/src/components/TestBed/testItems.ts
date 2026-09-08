
type EventProps = {
  action: string;
  data?: unknown;
}


export type TestItemProps = {
  index: string; 
  active: boolean;
  label: string;
  description: string;
  onEnable: EventProps;
  onDisable: EventProps;
  toggleActive: () => void;
  icon: string;
}

export const defaultTestItems = [
  {
    index: 'contextMenus',
    active: false,
    label: 'Context Menus',
    description: 'These are the generic context menus',
    icon: 'fa fa-bars',
    onEnable: {
      action:'OPEN_CONTEXT',
      data: {
        title:'CALL OF HAGLER',
        description:'This is a test menu',
        icon:'gun',
        canClose:true,
        menu:'main',
        searchBar:true,
        clickSounds:true, 
        hoverSounds:true,
        // menu:'main',
      
        // watermark:'https://via.placeholder.com/150x150',
      
        options:[
          {
            title:'Find Ranked',
            icon:'search',
            readOnly:true, 
          },
          {
            title:'Private Game',
            icon:'https://callofdutymaps.com/wp-content/uploads/MW-m16a4.png',
            description:"Allows you to define the rules of the game will not affect your rank",
            image:  'https://callofdutymaps.com/wp-content/uploads/MW-m16a4.png',
          },
          {
            title:'Edit Classes',
            icon:'edit',
            description:'Allows you edit the classes for this player',
            disabled:true,
          },
          {
            title:'Edit Classes',
            icon:'edit',
            arrow:true,
            description:'Allows you edit the classes for this player'
          },
          {
            title:'Edit Classes',
            icon:'edit',
            description:'Allows you edit the classes for this player'
          },
      
        ]
      }
    },
    onDisable: {action: 'CLOSE_CONTEXT'}
  },
  {
    index: 'statusInfo',
    active: false,
    label: 'Status Info',
    description: 'Used for keeping track of a players tasks',
    icon: 'fa fa-info',
    onEnable: {
      action: 'ADD_STATUS',
      data: {
        id: '1',
        title: 'Sanitation Job',
        description: 'Please collect all the trash from the streets marked on your map before the time runs out.',     
        icon: 'dumpster',
        progress: 50,
        time: 120,
      }
    },
    onDisable: {
      action: 'REMOVE_STATUS',
      data: '1'
    }
  },
  {
    index: 'showTextUI',
    active: false,
    label: 'Show Text UI',
    description: 'Used for showing a text UI',
    icon: 'fa fa-font',
    onEnable: {
      action: 'SHOW_TEXT_UI',
      data: {
        text: 'Press E to interact with the object',
      }
    },
    onDisable: {
      action: 'HIDE_TEXT_UI',
    }
  },
  {
    index: 'notification',
    active: false,
    label: 'Test Notification',
    description: 'Used for showing a notification',
    icon: 'fa fa-bell',
    onEnable: {
      action: 'ADD_NOTIFICATION',
      data: {
        id: '1',
        duration: 600000,
        iconColor: 'rgba(255, 0, 0, 0.5)',
        iconBg: 'rgba(255, 0, 0, 0.1)',
        title: 'Test Notification',
        description: 'Get yourself over to the Los Santos Customs and get your car fixed up. You can also get a new paint job while you are there.',
        position: 'top-center',
        icon: 'bell',
      },
    },
    onDisable: {
      
      action: 'HIDE_TEXT_UI',
    }
  },
  {
    index: 'progressBar',
    active: false,
    label: 'Progress Bar',
    description: 'Used for showing a progress bar',
    icon: 'fa fa-tasks',
    onEnable: {
      action : 'SHOW_PROGRESS',
      data : {
        position: 'top-center',
        icon: 'fa fa-bars',
        description: 'This is a progress bar',
        label: 'Progress',
        duration: 25000
      }
    },
    onDisable: {
      action: 'CANCEL_PROGRESS',
    }
  },
  {
    index: 'keyInputs',
    active: false,
    label: 'Key Inputs',
    description: 'Used for showing key inputs',
    icon: 'fa fa-keyboard',
    onEnable: {
      action: 'SET_KEY_INPUTS',
      data: {
        direction: 'row',
        inputs: [
          
          { qwerty: 'G', label: 'Open Menu', icon: 'fa fa-bars', delay: 1000 },
          { qwerty: 'Arrow Right', label: 'Open Menu', icon: 'fa fa-bars', delay: 1000 },
        ],
  
        position: 'bottom-center'
      }
    },
    onDisable: {
      action: 'HIDE_KEY_INPUTS',
    }
  },
  {
    index: 'dialog',
    active: false,
    label: 'NPC Dialogue',
    description: 'Used for showing NPC dialogue',
    icon: 'fa fa-user-tie',
    onEnable: {
      action: "DIALOG_STATE",
      data: {
        dialog       : "Is there anything I can do to postpone this?",
        id           : "my_dialogue",
        title        : "Officer",
        icon         : "fa-user-tie",
        prevDialog   : 'main',
        audioFile    : "audio.mp3",
  
        metadata    : [
          {
            icon : "fa-user-tie",
            label : "Officer",
            data  : "Grade 4",
            progress : 0,
          },
          {
            icon : "fa-user-tie",
            label : "Officer",
            data  : "Grade 4",
            progress : 75,
          },
          {
            icon : "fa-user-tie",
            label : "Officer",
            data  : "Grade 4",
          },
        ],
  
  
        responses : [
          {
            label     : "Yes",
            icon      : "fa-user-tie",
            description : "Lorem Ipsum is simply dummy text of the printing and typesetting industry. Lorem Ipsum has been the industry's standard dummy text ever since the 1500s when an unknown printer took a galley of type and scrambled it to make a type specimen book.",  
            dontClose : true,
            disabled:true, 
            actionid : "111",
            colorScheme: "#ff0000"
          },
          {
            label     : "No",
            icon      : "fa-user-tie",
            dontClose : true,
            actionid : "222"
          },
          {
            label     : "Maybe So",
            icon      : "fa-user-tie",
            dontClose : true,
            actionid : "333"
          },
          {
            label     : "Yesd",
            icon      : "fa-user-tie",
            // description : "This is a description",
            dontClose : true,
            actionid : "444"
          },
          {
            label     : "No",
            icon      : "fa-user-tie",
            dontClose : true,
            actionid : "555"
          },
          {
            label     : "Maybe So",
            icon      : "fa-user-tie",
            dontClose : true,
            actionid : "666"
          },
        ]
      }
    },
    onDisable: {
      action: 'DIALOG_STATE',
    }
  },
  {
    index: 'dialogue_cards',
    active: false,
    label: 'NPC Dialogue — offers',
    description: 'Replies drawn as cards: a picture, a name, a place and a figure',
    icon: 'fa fa-id-card',
    onEnable: {
      action: 'DIALOG_STATE',
      data: {
        id       : 'yard_work',
        title    : 'Vernon Pike',
        subtitle : 'Cypress Flats',
        dialog   : "Three things need collecting. Take one, or get out my way.",

        skill : {
          label: 'Reputation', level: 4, progress: 62,
          xp: 1840, nextLevelXp: 2600, xpToNext: 760,
          rankLabel: 'Regular',
        },

        metadata : [
          { label: 'Deals in', value: 'Muscle, Coupes' },
          { label: 'Pays', value: '85% of the going rate', emphasis: true },
        ],

        responses : [
          {
            index: 1, label: 'Sabre Turbo', sub: 'Sandy Shores', value: '$4,200',
            badge: 'Guarded', badgeTone: 'warn',
            // Deliberately a URL that does not resolve, so the fallback is
            // what this fixture actually proves.
            image: 'nui://dirk_projectCars/vehicleImages/sabregt.png',
            imageFallback: 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 170 62%22%3E%3Cpath fill=%22%23fff%22 fill-opacity=%220.92%22 fill-rule=%22evenodd%22 d=%22M10 48 L10 30 L44 26 L58 13 L106 13 L118 26 L158 29 L158 48 Z M31 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M36.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z M119 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M124.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z%22/%3E%3C/svg%3E',
            dontClose: true,
          },
          {
            index: 2, label: 'Futo GTX', sub: 'Vespucci Beach', value: '$2,800',
            badge: 'Street', badgeTone: 'ok',
            image: 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 170 62%22%3E%3Cpath fill=%22%23fff%22 fill-opacity=%220.92%22 fill-rule=%22evenodd%22 d=%22M12 48 L12 31 L34 27 L56 14 L96 14 L134 30 L156 33 L156 48 Z M29 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M34.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z M121 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M126.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z%22/%3E%3C/svg%3E',
            dontClose: true,
          },
          {
            index: 3, label: 'Burrito', sub: 'Elysian Island', value: '$6,500',
            badge: 'Convoy', badgeTone: 'bad',
            image: 'data:image/svg+xml;utf8,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 170 62%22%3E%3Cpath fill=%22%23fff%22 fill-opacity=%220.92%22 fill-rule=%22evenodd%22 d=%22M14 46 L14 22 L30 8 L142 8 L154 22 L154 46 Z M31 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M36.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z M121 48 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0 Z M126.22 48 a3.78 3.78 0 1 0 7.56 0 a3.78 3.78 0 1 0 -7.56 0 Z%22/%3E%3C/svg%3E',
            dontClose: true,
          },
          { index: 4, label: 'Nothing today', pin: true },
        ],
      }
    },
    onDisable: {
      action: 'DIALOG_STATE',
    }
  },
  {
    index: 'keycode',
    active: false,
    label: 'Keycode',
    description: 'Numeric keypad challenge — open with a target code, locks on correct entry',
    icon: 'fa fa-keyboard',
    onEnable: {
      action: 'OPEN_KEYCODE',
      data: {
        code: '1234',
        title: 'Security Panel',
        description: 'Enter the 4-digit override code',
        multipleTries: true,
        allowCancel: true,
        length: 4,
      },
    },
    onDisable: {
      action: 'CLOSE_KEYCODE',
    },
  },
  {
    index: 'inputMenus',
    active: false,
    label: 'Input Menus',
    description: 'Used for having the player fill out a form',
    icon: 'fa fa-file-alt',
    onEnable: {
      action: 'OPEN_INPUT_DIALOG',
      data: {
        inputs: [
          'Username',
          'Password',
          {icon:'user', type: 'checkbox', label: 'Remember Me', description: 'Check this box to remember your login information', checked: true},
          // {type: 'slider', label: 'Volume', description: 'Adjust the volume of the game', min: 0, max: 100, default: 50},
          // {type: 'date', label: 'Date of Birth', description: 'Enter your date of birth', default: true, format: 'MM/DD/YYYY', returnString: true, clearable: true},
          // {type: 'color', label: 'Primary Color', description: 'Select your primary color', default: '#7ac61f', format: 'hex'},
          // {type: 'select', label: 'Language', description: 'Select your preferred language', options: [{value: 'en', label: 'English'}, {value: 'es', label: 'Spanish'}, {value: 'fr', label: 'French'}], placeholder: 'Select a language', required: true},
          // {type: 'multi-select', label: 'Favourite Foods', description: 'Select your favourite foods', options: [{value: 'pizza', label: 'Pizza'}, {value: 'burger', label: 'Burger'}, {value: 'pasta', label: 'Pasta'}, {value: 'salad', label: 'Salad'}], placeholder: 'Select your favourite foods', required: true, clearable: true, maxSelectedValues: 2},
          // {type: 'textarea', label: 'Bio', description: 'Enter a short bio about yourself', placeholder: 'Enter your bio here', required: true, autosize: false},
          // {type: 'time', label: 'Time', description: 'Select the time', default: '12:00', format: '12', clearable: true},
          // {type: 'date-range', label: 'Date Range', description: 'Select a date range', default: ['01/01/2022', '01/02/2022'], format: 'MM/DD/YYYY', returnString: true, clearable: true},
          // {type: 'number', label: 'Age', description: 'Enter your age', placeholder: 'Enter your age', required: true, min: 18, max: 100, default: 18, precision: 0, step: 1},
          // {type: 'input', label: 'Email', description: 'Enter your email address', placeholder: 'Enter your email address', required: true},
        
        ],
        info: {
          title: 'Login',
          description: 'Enter your login information below',
          icon: 'user',
          backButton: 'menu_to_return_to',
          allowCancel: true,
        }
      }
    },
    onDisable: {
      action: 'CLOSE_INPUT_DIALOG',
    }
  },
] as TestItemProps[]  