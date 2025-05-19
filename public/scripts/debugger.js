// Yksinkertainen debugger-skripti, joka testaa perustoiminnallisuuden
(function() {
    console.log("DEBUGGER: Script loaded");
    
    // Odota, että DOM on täysin ladattu
    document.addEventListener('DOMContentLoaded', function() {
        console.log("DEBUGGER: DOM fully loaded");
        
        // Etsi painikkeet
        const createTableButton = document.getElementById('create-table-button');
        const joinTableButton = document.getElementById('join-table-button');
        const playSoloButton = document.getElementById('play-solo-button');
        
        console.log("DEBUGGER: Buttons found?", {
            createTableButton: !!createTableButton,
            joinTableButton: !!joinTableButton,
            playSoloButton: !!playSoloButton
        });
        
        // Lisää suorat tapahtumankäsittelijät, ohittaen muu logiikka
        if (createTableButton) {
            createTableButton.addEventListener('click', function() {
                console.log("DEBUGGER: Create table button clicked");
                alert("Create table button works!");
            });
        }
        
        if (joinTableButton) {
            joinTableButton.addEventListener('click', function() {
                console.log("DEBUGGER: Join table button clicked");
                alert("Join table button works!");
            });
        }
        
        if (playSoloButton) {
            playSoloButton.addEventListener('click', function() {
                console.log("DEBUGGER: Play solo button clicked");
                // Suora siirtyminen solo.html-sivulle
                window.location.href = 'solo.html';
            });
        }
        
        // Lisää näkyvä indikaattori, että skripti on ladattu
        const indicator = document.createElement('div');
        indicator.style.position = 'fixed';
        indicator.style.top = '10px';
        indicator.style.right = '10px';
        indicator.style.padding = '10px';
        indicator.style.background = 'green';
        indicator.style.color = 'white';
        indicator.style.fontWeight = 'bold';
        indicator.style.zIndex = '9999';
        indicator.textContent = 'Debugger loaded';
        document.body.appendChild(indicator);
    });
})();