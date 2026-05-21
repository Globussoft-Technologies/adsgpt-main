

async function fetchAllUser() {
  try {
    document.querySelector('#user-list').innerHTML = `<p>Loading data.....</p>`
    let response = await fetch(`/adsgpt/user-intreaction-data/get-user-id`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!response.ok) {
      throw new Error('User not found or invalid response');
    }
    let data = await response.json();
    // data = JSON.parse(data);
    if (data) {
      document.querySelector('#user-list').innerHTML = ""
      data.map((data) => {
        document.querySelector('#user-list').innerHTML += `
    <div class="card">
 
  <div class="img">
  </div>
  <span>${data.user_id}</span>
  <p class="job"> ${data.user_name}</p>
  <button onClick = searchUser('${data.user_id}')> View data
  </button>
</div>
    `
      })
    }
  } catch (error) {
    // console.log(error);
    document.querySelector('#user-list').innerHTML = `
     <p>There is some error:${error}</p>`
  }
}

fetchAllUser()

async function searchUser(userId) {
  document.querySelector('#user-list').innerHTML = ''
  // const userId = document.querySelector('#searchUser').value.trim();
  const searchResultElement = document.querySelector('#searchResult');
  searchResultElement.textContent = `Searching for User ID: ${userId}`;

  if (userId) {
    try {
      const response = await fetch(`/adsgpt/user-intreaction-data/get-user-data/${userId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!response.ok) {
        throw new Error('User not found or invalid response');
      }

      let data = await response.json();
      data = JSON.parse(data);
      searchResultElement.textContent = "";

      if (!document.querySelector('.user-info')) {
        const htmlForData = `
                    <header>
                        <h1>Interaction Data </h1>
                    </header>
                    <div class="user-info">
                            <p><span class="label">Name:</span> <span id="user-name" class="user-detail">${data.user_name.toUpperCase()}</span></p>
                            <p><span class="label">Email:</span> <span id="user-email" class="user-detail">${data.user_email}</span></p>
                        </div>
                    <div class="search-section">
                        <label for="session-date">Enter Session Date (MM/DD/YYYY): </label>
                        <input type="text" id="session-date" placeholder="e.g., 1/20/2025">
                        <button id="search-btn">Search</button>
                    </div>
                `;
        document.querySelector('.container').innerHTML = ''
        document.querySelector('.container').insertAdjacentHTML("afterbegin", htmlForData);
      } else {
        document.getElementById('user-name').textContent = data.user_name.toUpperCase();
        document.getElementById('user-email').textContent = data.user_email;
      }
      if (!document.getElementById('sessions-container')) {
        const sessionsContainerHtml = `<div id="sessions-container"></div>`;
        document.querySelector('.container').insertAdjacentHTML("beforeend", sessionsContainerHtml);
      }
      displaySessions(data?.sessions);
      document.getElementById('search-btn').addEventListener('click', function () {
        const sessionDateInput = document.getElementById('session-date').value.trim();

        if (sessionDateInput) {
          const filteredSessions = data.sessions.filter(session => session.sessionDate === sessionDateInput);
          displaySessions(filteredSessions);
        } else {
          displaySessions(data?.sessions);
        }
      });

    } catch (error) {
      // console.error(error);
      searchResultElement.textContent = "Error: User not found or request failed.";
    }
  } else {
    searchResultElement.textContent = "";
  }
}


function displaySessions(filteredSessions) {
  const sessionsContainer = document.getElementById('sessions-container');
  sessionsContainer.innerHTML = ''; 
  if (filteredSessions && filteredSessions.length > 0) {
    filteredSessions.forEach(session => {
      const sessionCard = document.createElement('div');
      sessionCard.classList.add('session-card');


      sessionCard.innerHTML = `
        <div class="session-header">
          <h3>Session ID: ${session.sessionId}</h3>
          <p class="timestamp">Session Date: ${session.sessionDate}</p>
        </div>
      `;
      if (session.chats && session.chats.length > 0) {
        session.chats.forEach(chat => {
          sessionCard.innerHTML += `
            <div class="chat-header">
              <h4>Chat Session ID: ${chat.chatSessionId}</h4>
            </div>
          `;
          if (chat.clicks && chat.clicks.length > 0) {
            chat.clicks.forEach(click => {
              const clickCard = document.createElement('div');
              clickCard.classList.add('click-card');
              clickCard.innerHTML = `
                <div class="card-header">Click Data</div>
                <div class="card-info">
                  ${Object.keys(click).map(key => {
                    const clickData = click[key];

                    if (
                      key.includes('chatbot-card-Search Advertiser') || 
                      key.match(/-?\d{10,11}-(piChart|lineChart)/) || 
                      key.match(/^[-]?\d{11,}$/) ||
                      key.includes('chatbot-card-chatbot-header p-3') || 
                      key.includes('chatbot-card-chatbot-button close')||
                      key.includes('chatbot-card-close-chat-history') ||
                      !isNaN(key.trim())
                    ) {
                      return ''; 
                    }

                    if (key.includes('chatBot') || key.includes('chatbot-card-flex')) {
                      return `
                        <strong>${key.includes('chatbot-card-flex') ? 'chatBot-FAQ' : key}</strong><br>
                        <strong>${key.includes('chatbot-card-flex') ? 'Selected-FAQ' : "N/A"}:</strong> ${clickData?.innerText || 'N/A'}<br>
                        <strong>Clicks Count:</strong> ${clickData.count || 'N/A'}<br>
                        <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
                      `;
                    }
                    if (key.match(/^chatbot-card-id-[a-z0-9]+-AdvertiserValue$/) ) {
                       return `
                       <strong>Advertiser Search</strong><br>
                       <strong>Values:</strong> ${clickData?.advertiserSearchValue || 'N/A'}<br>
                       <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
                     `;

                      }

                    return `
                      <strong>${key}</strong><br>
                      <strong>Ad ID:</strong> ${clickData.adId || 'N/A'}<br>
                      <strong>Component:</strong> ${clickData.component || 'N/A'}<br>
                      <strong>Action:</strong> ${clickData?.innerText || 'N/A'}<br>
                      <strong>Clicks Count:</strong> ${clickData.count || 'N/A'}<br>
                      <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
                    `;
                  }).join('')}
                </div>
              `;
              sessionCard.appendChild(clickCard);
            });
          }

          if (chat.copy && chat.copy.length > 0) {
            chat.copy.forEach(copy => {
              const copyCard = document.createElement('div');
              copyCard.classList.add('copy-card');
              copyCard.innerHTML = `
                <div class="card-header">Copy Data</div>
                <div class="card-info">
                  ${Object.keys(copy).map(key => {
                    const copyData = copy[key];
                    if(key.includes('chats-chatbot-card')){
                        return `
                        <strong>${key}</strong><br>
                        <strong>Component:</strong> ChatBot-Chats<br>
                        <strong>Copy Text:</strong> [${copyData.copiedText ? copyData.copiedText.join('||') : 'N/A'}]<br>
                        <strong>Copy Count:</strong> ${copyData.count || 'N/A'}<br>
                        <span class="timestamp">Timestamp: ${copyData.timestamp || 'N/A'}</span><br><hr>
                      `;

                    }
                    return `
                      <strong>${key}</strong><br>
                      <strong>Ad ID:</strong> ${copyData.adId || 'N/A'}<br>
                      <strong>Component:</strong> ${copyData.component || 'N/A'}<br>
                      <strong>Copy Text:</strong> [${copyData.copiedText ? copyData.copiedText.join('||') : 'N/A'}]<br>
                      <strong>Copy Count:</strong> ${copyData.count || 'N/A'}<br>
                      <span class="timestamp">Timestamp: ${copyData.timestamp || 'N/A'}</span><br><hr>
                    `;
                  }).join('')}
                </div>
              `;
              sessionCard.appendChild(copyCard);
            });
          }
          if (chat.scroll && chat.scroll.length > 0) {
            chat.scroll.forEach(scroll => {
              const scrollCard = document.createElement('div');
              scrollCard.classList.add('scroll-card');
              scrollCard.innerHTML = `
                <div class="card-header">Scroll Data</div>
                <div class="card-info">
                  ${Object.keys(scroll).map(key => {
                    const scrollData = scroll[key];
                    return `
                      <strong>${key}</strong><br>
                      <strong>Scroll Count:</strong> ${scrollData.scrollCount}<br>
                      <strong>Total Percent Seen:</strong> ${scrollData.totalPercentSeen}<br>
                      <strong>Total New Data Fetched:</strong> ${scrollData.totalNewDataFetched || scrollData?.adId?.length || 0}<br>
                       <strong>Ads Seen:</strong> ${scrollData.adId? scrollData.adId.join(',') : 0}<br>
                      <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
                    `;
                  }).join('')}
                </div>
              `;
              sessionCard.appendChild(scrollCard);
            });
          }
          if (chat.adCreativeSide && chat.adCreativeSide.length > 0) {
            chat.adCreativeSide.forEach(creative => {
              const adCreativeCard = document.createElement('div');
              adCreativeCard.classList.add('creative-card');
              adCreativeCard.innerHTML = `
                <div class="card-header">AdCreative Data</div>
                <div class="card-info">
                  ${Object.keys(creative).map(key => {
                    return `
                      <strong>AdCreativeSideBar</strong><br>
                      <strong>BrandDescription:</strong> ${creative?.brandDescription || "N/A"}<br>
                      <strong>BrandName:</strong> ${creative?.brandName || "N/A"}<br>
                      <strong>CallToAction:</strong> ${creative?.cta || "N/A"}<br>
                       <strong>Platform:</strong> ${creative?.platform || "N/A"}<br>
                      <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
                    `;
                  }).join('')}
                </div>
              `;
              sessionCard.appendChild(adCreativeCard);
            });
          }
          if (chat.adCopySide && chat.adCopySide.length > 0) {
            chat.adCopySide.forEach(copy => {
              const adCopyCard = document.createElement('div');
              adCopyCard.classList.add('adCopy-card');
              adCopyCard.innerHTML = `
                <div class="card-header">AdCopy Data</div>
                <div class="card-info">
                  ${Object.keys(copy).map(key => {
                    return `
                      <strong>AdCopySideBar</strong><br>
                      <strong>BrandDescription:</strong> ${copy?.brandDescription || "N/A"}<br>
                      <strong>BrandName:</strong> ${copy?.brandName || "N/A"}<br>
                      <strong>CallToAction:</strong> ${copy?.cta || "N/A"}<br>
                       <strong>Platform:</strong> ${copy?.platform || "N/A"}<br>
                      <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
                    `;
                  }).join('')}
                </div>
              `;
              sessionCard.appendChild(adCopyCard);
            });
          }

          else{
            const NoDataCard = document.createElement('div');
            NoDataCard.classList.add('noData-card');
            NoDataCard.innerHTML = `<div class="card-header">No data found</div>`
            sessionCard.appendChild(NoDataCard);
          }
        });
      }

      sessionsContainer.appendChild(sessionCard);
    });
  } else {
    sessionsContainer.innerHTML = `<p>No sessions found for the given date.</p>`;
  }
}


// function displaySessions(filteredSessions) {
//   const sessionsContainer = document.getElementById('sessions-container');
//   sessionsContainer.innerHTML = '';

//   if (filteredSessions && filteredSessions.length > 0) {
//     filteredSessions.forEach(session => {
//       const sessionCard = document.createElement('div');
//       sessionCard.classList.add('session-card');

//       // Create Session Header
//       sessionCard.innerHTML = `
//         <div class="session-header" onclick="viewSessionDetails('${}')">
//           <h3>Session ID: ${session.sessionId}</h3>
//           <p class="timestamp">Session Date: ${session.sessionDate}</p>
//         </div>
//         <button class="switch-session-btn" onclick="switchSession('${session}')">Switch Session</button>
//       `;

//       sessionsContainer.appendChild(sessionCard);
//     });
//   } else {
//     sessionsContainer.innerHTML = `<p>No sessions found for the given date.</p>`;
//   }
// }

// // Function to Display Session Details
// function viewSessionDetails(session) {
//   console.log(session);
//   const sessionsContainer = document.getElementById('sessions-container');
//     sessionsContainer.innerHTML = ''; 
//     const sessionCard = document.createElement('div');
//       sessionCard.classList.add('session-card');
//       sessionCard.innerHTML = `
//         <div class="session-header">
//           <h3>Session ID: ${session.sessionId}</h3>
//           <p class="timestamp">Session Date: ${session.sessionDate}</p>
//         </div>
//       `;
//   if (session.chats && session.chats.length > 0) {
//     session.chats.forEach(chat => {
//       sessionCard.innerHTML += `
//         <div class="chat-header">
//           <h4>Chat Session ID: ${chat.chatSessionId}</h4>
//         </div>
//       `;
//       if (chat.clicks && chat.clicks.length > 0) {
//         chat.clicks.forEach(click => {
//           const clickCard = document.createElement('div');
//           clickCard.classList.add('click-card');
//           clickCard.innerHTML = `
//             <div class="card-header">Click Data</div>
//             <div class="card-info">
//               ${Object.keys(click).map(key => {
//                 const clickData = click[key];

//                 if (
//                   key.includes('chatbot-card-Search Advertiser') || 
//                   key.match(/-?\d{10,11}-(piChart|lineChart)/) || 
//                   key.match(/^[-]?\d{11,}$/) ||
//                   key.includes('chatbot-card-chatbot-header p-3') || 
//                   key.includes('chatbot-card-chatbot-button close')||
//                   key.includes('chatbot-card-close-chat-history') ||
//                   !isNaN(key.trim())
//                 ) {
//                   return ''; 
//                 }

//                 if (key.includes('chatBot') || key.includes('chatbot-card-flex')) {
//                   return `
//                     <strong>${key.includes('chatbot-card-flex') ? 'chatBot-FAQ' : key}</strong><br>
//                     <strong>${key.includes('chatbot-card-flex') ? 'Selected-FAQ' : "N/A"}:</strong> ${clickData?.innerText || 'N/A'}<br>
//                     <strong>Clicks Count:</strong> ${clickData.count || 'N/A'}<br>
//                     <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
//                   `;
//                 }
//                 if (key.match(/^chatbot-card-id-[a-z0-9]+-AdvertiserValue$/) ) {
//                    return `
//                    <strong>Advertiser Search</strong><br>
//                    <strong>Values:</strong> ${clickData?.advertiserSearchValue || 'N/A'}<br>
//                    <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
//                  `;

//                   }

//                 return `
//                   <strong>${key}</strong><br>
//                   <strong>Ad ID:</strong> ${clickData.adId || 'N/A'}<br>
//                   <strong>Component:</strong> ${clickData.component || 'N/A'}<br>
//                   <strong>Action:</strong> ${clickData?.innerText || 'N/A'}<br>
//                   <strong>Clicks Count:</strong> ${clickData.count || 'N/A'}<br>
//                   <span class="timestamp">Timestamp: ${clickData.timestamp || 'N/A'}</span><br><hr>
//                 `;
//               }).join('')}
//             </div>
//           `;
//           sessionCard.appendChild(clickCard);
//         });
//       }

//       if (chat.copy && chat.copy.length > 0) {
//         chat.copy.forEach(copy => {
//           const copyCard = document.createElement('div');
//           copyCard.classList.add('copy-card');
//           copyCard.innerHTML = `
//             <div class="card-header">Copy Data</div>
//             <div class="card-info">
//               ${Object.keys(copy).map(key => {
//                 const copyData = copy[key];
//                 if(key.includes('chats-chatbot-card')){
//                     return `
//                     <strong>${key}</strong><br>
//                     <strong>Component:</strong> ChatBot-Chats<br>
//                     <strong>Copy Text:</strong> [${copyData.copiedText ? copyData.copiedText.join('||') : 'N/A'}]<br>
//                     <strong>Copy Count:</strong> ${copyData.count || 'N/A'}<br>
//                     <span class="timestamp">Timestamp: ${copyData.timestamp || 'N/A'}</span><br><hr>
//                   `;

//                 }
//                 return `
//                   <strong>${key}</strong><br>
//                   <strong>Ad ID:</strong> ${copyData.adId || 'N/A'}<br>
//                   <strong>Component:</strong> ${copyData.component || 'N/A'}<br>
//                   <strong>Copy Text:</strong> [${copyData.copiedText ? copyData.copiedText.join('||') : 'N/A'}]<br>
//                   <strong>Copy Count:</strong> ${copyData.count || 'N/A'}<br>
//                   <span class="timestamp">Timestamp: ${copyData.timestamp || 'N/A'}</span><br><hr>
//                 `;
//               }).join('')}
//             </div>
//           `;
//           sessionCard.appendChild(copyCard);
//         });
//       }
//       if (chat.scroll && chat.scroll.length > 0) {
//         chat.scroll.forEach(scroll => {
//           const scrollCard = document.createElement('div');
//           scrollCard.classList.add('scroll-card');
//           scrollCard.innerHTML = `
//             <div class="card-header">Scroll Data</div>
//             <div class="card-info">
//               ${Object.keys(scroll).map(key => {
//                 const scrollData = scroll[key];
//                 return `
//                   <strong>${key}</strong><br>
//                   <strong>Scroll Count:</strong> ${scrollData.scrollCount}<br>
//                   <strong>Total Percent Seen:</strong> ${scrollData.totalPercentSeen}<br>
//                   <strong>Total New Data Fetched:</strong> ${scrollData.totalNewDataFetched || scrollData?.adId?.length || 0}<br>
//                    <strong>Ads Seen:</strong> ${scrollData.adId? scrollData.adId.join(',') : 0}<br>
//                   <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
//                 `;
//               }).join('')}
//             </div>
//           `;
//           sessionCard.appendChild(scrollCard);
//         });
//       }
//       if (chat.adCreativeSide && chat.adCreativeSide.length > 0) {
//         chat.adCreativeSide.forEach(creative => {
//           const adCreativeCard = document.createElement('div');
//           adCreativeCard.classList.add('creative-card');
//           adCreativeCard.innerHTML = `
//             <div class="card-header">AdCreative Data</div>
//             <div class="card-info">
//               ${Object.keys(creative).map(key => {
//                 return `
//                   <strong>AdCreativeSideBar</strong><br>
//                   <strong>BrandDescription:</strong> ${creative?.brandDescription || "N/A"}<br>
//                   <strong>BrandName:</strong> ${creative?.brandName || "N/A"}<br>
//                   <strong>CallToAction:</strong> ${creative?.cta || "N/A"}<br>
//                    <strong>Platform:</strong> ${creative?.platform || "N/A"}<br>
//                   <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
//                 `;
//               }).join('')}
//             </div>
//           `;
//           sessionCard.appendChild(adCreativeCard);
//         });
//       }
//       if (chat.adCopySide && chat.adCopySide.length > 0) {
//         chat.adCopySide.forEach(copy => {
//           const adCopyCard = document.createElement('div');
//           adCopyCard.classList.add('adCopy-card');
//           adCopyCard.innerHTML = `
//             <div class="card-header">AdCopy Data</div>
//             <div class="card-info">
//               ${Object.keys(copy).map(key => {
//                 return `
//                   <strong>AdCopySideBar</strong><br>
//                   <strong>BrandDescription:</strong> ${copy?.brandDescription || "N/A"}<br>
//                   <strong>BrandName:</strong> ${copy?.brandName || "N/A"}<br>
//                   <strong>CallToAction:</strong> ${copy?.cta || "N/A"}<br>
//                    <strong>Platform:</strong> ${copy?.platform || "N/A"}<br>
//                   <span class="timestamp">Timestamp: ${new Date().toISOString()}</span><br><hr>
//                 `;
//               }).join('')}
//             </div>
//           `;
//           sessionCard.appendChild(adCopyCard);
//         });
//       }
//     });
//   }

//  else {
//   sessionsContainer.innerHTML = `<p>No sessions found for the given date.</p>`;
// }

// }

// // Function to Close Session Details
// function closeSessionDetails() {
//   document.getElementById('session-details').style.display = "none";
// }

// // Function to Switch Sessions
// function switchSession(sessionId) {
//   alert(`Switched to session: ${sessionId}`);
// }